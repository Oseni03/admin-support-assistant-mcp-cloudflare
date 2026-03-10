import * as fs from "fs";
import * as path from "path";
import { OpenAPIToMCPConverter } from "./src/openapi-mcp-server/openapi/parser";

// Read the Notion OpenAPI spec
const openApiSpecPath = path.join(__dirname, "notion-openapi.json");
const openApiSpec = JSON.parse(fs.readFileSync(openApiSpecPath, "utf-8"));

// Create the converter
const converter = new OpenAPIToMCPConverter(openApiSpec);

// Generate the MCP tools
const { tools, openApiLookup, zip } = converter.convertToMCPTools();

// Output the generated tools
console.log("Generated Notion MCP Tools:");
console.log(JSON.stringify(tools, null, 2));

// You can also save this to a file if needed
const outputPath = path.join(__dirname, "generated-notion-tools.json");
fs.writeFileSync(outputPath, JSON.stringify({ tools, openApiLookup, zip }, null, 2));
console.log(`\nSaved generated tools to: ${outputPath}`);
