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
  const plan = c.req.query("plan") || "pro";
  const email = c.req.query("email");

  return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Upgrade Your Plan</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f9fafb; padding: 40px 20px; }
          .container { max-width: 1000px; margin: 0 auto; }
          h1 { text-align: center; margin-bottom: 40px; color: #111827; }
          .plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; margin-bottom: 40px; }
          .plan-card { background: white; padding: 32px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); border: 2px solid transparent; }
          .plan-card.recommended { border-color: #0070f3; position: relative; }
          .plan-card.recommended::before { content: "RECOMMENDED"; position: absolute; top: -12px; left: 50%; transform: translateX(-50%); background: #0070f3; color: white; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; }
          .plan-name { font-size: 24px; font-weight: 700; margin-bottom: 8px; color: #111827; }
          .plan-price { font-size: 36px; font-weight: 700; color: #0070f3; margin-bottom: 8px; }
          .plan-price span { font-size: 16px; color: #6b7280; }
          .features { list-style: none; margin: 24px 0; }
          .features li { padding: 8px 0; color: #374151; display: flex; align-items: center; }
          .features li::before { content: "✓"; color: #10b981; font-weight: 700; margin-right: 8px; }
          .cta-button { width: 100%; padding: 16px; background: #0070f3; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; }
          .cta-button:hover { background: #0051cc; }
          .current { background: #e5e7eb; cursor: not-allowed; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Choose Your Plan</h1>
          <div class="plans">
            <div class="plan-card">
              <div class="plan-name">Free</div>
              <div class="plan-price">$0<span>/month</span></div>
              <ul class="features">
                <li>Read-only access</li>
                <li>1 integration</li>
                <li>Gmail, Calendar, Drive</li>
                <li>Basic tools only</li>
              </ul>
              <button class="cta-button current" disabled>Current Plan</button>
            </div>

            <div class="plan-card ${plan === "pro" ? "recommended" : ""}">
              <div class="plan-name">Pro</div>
              <div class="plan-price">$10<span>/month</span></div>
              <ul class="features">
                <li>Full read & write access</li>
                <li>Up to 3 integrations</li>
                <li>Gmail, Calendar, Drive</li>
                <li>All basic tools</li>
                <li>Email sending & management</li>
                <li>File uploads</li>
              </ul>
              <button class="cta-button" onclick="selectPlan('pro', '${email}')">
                Upgrade to Pro
              </button>
            </div>

            <div class="plan-card ${plan === "enterprise" ? "recommended" : ""}">
              <div class="plan-name">Enterprise</div>
              <div class="plan-price">$30<span>/month</span></div>
              <ul class="features">
                <li>Everything in Pro</li>
                <li>Unlimited integrations</li>
                <li>All providers (Notion, Slack)</li>
                <li>Advanced batch operations</li>
                <li>Priority support</li>
                <li>API access</li>
              </ul>
              <button class="cta-button" onclick="selectPlan('enterprise', '${email}')">
                Upgrade to Enterprise
              </button>
            </div>
          </div>
        </div>

        <script>
          async function selectPlan(planName, email) {
            if (!email) {
              email = prompt('Please enter your email:');
              if (!email) return;
            }

            try {
              const response = await fetch('/billing/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, plan: planName })
              });

              const data = await response.json();
              
              if (data.checkoutUrl) {
                window.location.href = data.checkoutUrl;
              } else {
                alert('Error: ' + (data.error || 'Failed to create checkout'));
              }
            } catch (error) {
              alert('Error creating checkout: ' + error.message);
            }
          }
        </script>
      </body>
    </html>
  `);
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

    await billingService.cancelSubscription(user.id);

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
            await billingService.activateSubscription({
              userId: userId as string,
              plan: plan as "pro" | "enterprise",
              polarCustomerId: customerId,
              polarSubscriptionId: subscriptionId,
            });

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
              plan: "free",
              subscriptionStatus: "canceled",
              updatedAt: new Date(),
            })
            .where(eq(schema.user.id, sub.id));

          console.log(`✅ Downgraded user ${sub.id} to free`);
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
