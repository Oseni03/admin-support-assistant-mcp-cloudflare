import { Hono } from "hono";
import { createDbClient } from "../db/client";
import { createPolarClient } from "../lib/polar";
import { BillingService } from "../services/billing";
import { IntegrationService } from "../services/integrations";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { validateEvent } from "@polar-sh/sdk/webhooks";
import { PLANS } from "../lib/plans";

const billing = new Hono<{ Bindings: Env }>();

// Get current subscription info
billing.get("/subscription", async (c) => {
  try {
    const userEmail = c.req.query("email");
    if (!userEmail) {
      return c.json({ error: "Email required" }, 400);
    }

    const db = createDbClient(c.env.DB);

    const user = await db.query.user.findFirst({
      where: eq(schema.user.email, userEmail),
    });

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    const polar = createPolarClient(c.env);
    const billingService = new BillingService(db, polar);
    const integrationService = new IntegrationService(db);

    const currentPlan = await billingService.getUserPlan(user.id);
    const integrations = await integrationService.getUserIntegrations(user.id);
    const planConfig = PLANS[currentPlan];

    return c.json({
      user: {
        email: user.email,
        name: user.name,
      },
      subscription: {
        plan: currentPlan,
        status: user.subscriptionStatus || "active",
        features: planConfig.features,
        price: planConfig.price,
      },
      integrations: {
        connected: integrations.length,
        max: planConfig.features.maxIntegrations,
        list: integrations.map((i) => i.provider),
      },
      canUpgrade: currentPlan !== "enterprise",
      availablePlans: Object.entries(PLANS)
        .filter(([key]) => key !== "free" && key !== currentPlan)
        .map(([key, config]) => ({
          name: key,
          price: config.price,
          features: config.features,
        })),
    });
  } catch (error: any) {
    console.error("Error fetching subscription:", error);
    return c.json({ error: error.message }, 500);
  }
});

// Create checkout session
billing.post("/checkout", async (c) => {
  try {
    const body = await c.req.json();
    const { email, plan } = body;

    if (!email || !plan) {
      return c.json({ error: "Email and plan required" }, 400);
    }

    if (plan !== "pro" && plan !== "enterprise") {
      return c.json({ error: "Invalid plan. Must be 'pro' or 'enterprise'" }, 400);
    }

    const db = createDbClient(c.env.DB);
    const user = await db.query.user.findFirst({
      where: eq(schema.user.email, email),
    });

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    const polar = createPolarClient(c.env);
    const billingService = new BillingService(db, polar);

    const checkoutUrl = await billingService.createCheckoutUrl(user.id, email, plan, `${c.env.SERVER_URL}/billing/success`);

    return c.json({ checkoutUrl });
  } catch (error: any) {
    console.error("Error creating checkout:", error);
    return c.json({ error: error.message }, 500);
  }
});

// Checkout page with plan selection
billing.get("/checkout", async (c) => {
  try {
    const plan = c.req.query("plan") as "pro" | "enterprise" | undefined;

    if (!plan || (plan !== "pro" && plan !== "enterprise")) {
      return c.html(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Choose Plan</title>
            <style>
              body { font-family: system-ui; max-width: 800px; margin: 40px auto; padding: 20px; }
              .plans { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
              .plan { border: 2px solid #e5e7eb; border-radius: 12px; padding: 24px; }
              .plan.featured { border-color: #0070f3; }
              h1 { text-align: center; }
              .price { font-size: 48px; font-weight: bold; margin: 16px 0; }
              .features { list-style: none; padding: 0; }
              .features li { padding: 8px 0; }
              .features li:before { content: "✓ "; color: #0070f3; font-weight: bold; }
              .cta { background: #0070f3; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; width: 100%; font-size: 16px; }
              .cta:hover { background: #0051cc; }
            </style>
          </head>
          <body>
            <h1>Choose Your Plan</h1>
            <p style="text-align: center; color: #666;">7-day free trial • No credit card required</p>
            <div class="plans">
              <div class="plan">
                <h2>Pro</h2>
                <div class="price">$${PLANS.pro.price}<span style="font-size: 18px; color: #666;">/mo</span></div>
                <ul class="features">
                  <li>Up to 3 integrations</li>
                  <li>Gmail, Calendar, Drive</li>
                  <li>Full read/write access</li>
                  <li>Email support</li>
                </ul>
                <button class="cta" onclick="window.location.href='/billing/checkout?plan=pro'">Start Trial</button>
              </div>
              <div class="plan featured">
                <h2>Enterprise ⭐</h2>
                <div class="price">$${PLANS.enterprise.price}<span style="font-size: 18px; color: #666;">/mo</span></div>
                <ul class="features">
                  <li>Unlimited integrations</li>
                  <li>All Pro features</li>
                  <li>Notion & Slack</li>
                  <li>Batch operations</li>
                  <li>Priority support</li>
                </ul>
                <button class="cta" onclick="window.location.href='/billing/checkout?plan=enterprise'">Start Trial</button>
              </div>
            </div>
          </body>
        </html>
      `);
    }

    // Get user from session/auth
    const userEmail = c.req.query("email"); // In production, get from authenticated session
    if (!userEmail) {
      return c.text("Unauthorized", 401);
    }

    const db = createDbClient(c.env.DB);
    const user = await db.query.user.findFirst({
      where: eq(schema.user.email, userEmail),
    });

    if (!user) {
      return c.text("User not found", 404);
    }

    const polar = createPolarClient(c.env);
    const billingService = new BillingService(db, polar);

    const checkoutUrl = await billingService.createCheckoutUrl(user.id, userEmail, plan, `${c.env.SERVER_URL}/billing/success`);

    return c.redirect(checkoutUrl);
  } catch (error: any) {
    console.error("Error creating checkout:", error);
    return c.text(`Error: ${error.message}`, 500);
  }
});

// Success page
billing.get("/success", async (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Subscription Activated</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; }
          .card { background: white; padding: 3rem; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 500px; }
          h1 { color: #10b981; margin-bottom: 1rem; font-size: 32px; }
          p { color: #6b7280; line-height: 1.6; margin-bottom: 1rem; }
          .feature-list { text-align: left; margin: 24px 0; list-style: none; }
          .feature-list li { padding: 8px 0; color: #374151; }
          .feature-list li::before { content: "✓"; color: #10b981; font-weight: 700; margin-right: 8px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🎉 Welcome to Pro!</h1>
          <p>Your subscription has been successfully activated.</p>
          <ul class="feature-list">
            <li>Full read & write access enabled</li>
            <li>All tools are now available</li>
            <li>Connect up to 3 integrations</li>
          </ul>
          <p>You can close this window and return to the application.</p>
        </div>
      </body>
    </html>
  `);
});

// Cancel subscription
billing.post("/cancel", async (c) => {
  try {
    const body = await c.req.json();
    const { email } = body;

    if (!email) {
      return c.json({ error: "Email required" }, 400);
    }

    const db = createDbClient(c.env.DB);
    const user = await db.query.user.findFirst({
      where: eq(schema.user.email, email),
    });

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    const polar = createPolarClient(c.env);
    const billingService = new BillingService(db, polar);

    await billingService.updateSubscriptionStatus(user.id, "cancelled");

    return c.json({
      message: "Subscription canceled. You'll be downgraded to Free plan at the end of your billing period.",
    });
  } catch (error: any) {
    console.error("Error canceling subscription:", error);
    return c.json({ error: error.message }, 500);
  }
});

// Polar webhook handler
billing.post("/webhook", async (c) => {
  try {
    const body = await c.req.text();
    const signature = c.req.header("webhook-signature");

    if (!signature) {
      return c.json({ error: "Missing signature" }, 400);
    }

    const event = validateEvent(body, c.req.header as any, c.env.POLAR_WEBHOOK_SECRET);

    const db = createDbClient(c.env.DB);
    const polar = createPolarClient(c.env);
    const billingService = new BillingService(db, polar);

    console.log("Polar webhook event:", event.type);

    switch (event.type) {
      case "checkout.created":
      case "checkout.updated":
        if (event.data.status === "confirmed") {
          const userId = event.data.metadata?.userId;
          const plan = event.data.metadata?.plan;
          const customerId = event.data.customerId;
          const subscriptionId = event.data.subscriptionId;

          if (userId && plan && customerId && subscriptionId) {
            await billingService.activateSubscription(userId as string, plan as "pro" | "enterprise", customerId, subscriptionId);

            console.log(`✅ Activated ${plan} for user ${userId}`);
          }
        }
        break;

      case "subscription.canceled":
        const sub = await db.query.user.findFirst({
          where: eq(schema.user.polarSubscriptionId, event.data.id),
        });

        if (sub) {
          await db
            .update(schema.user)
            .set({
              subscriptionStatus: "cancelled",
              updatedAt: new Date(),
            })
            .where(eq(schema.user.id, sub.id));

          console.log(`✅ Downgraded user ${sub.id} to cancelled`);
        }
        break;
    }

    return c.json({ received: true });
  } catch (error: any) {
    console.error("Webhook error:", error);
    return c.json({ error: error.message }, 500);
  }
});

export { billing as billingHandler };
