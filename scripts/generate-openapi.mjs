import { readFile, writeFile } from "node:fs/promises";

const baseUrl = String(process.env.PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/+$/, "");
if (!/^https:\/\//i.test(baseUrl)) {
  console.error("Définissez PUBLIC_BASE_URL ou BASE_URL avec une URL HTTPS, par exemple https://mon-service.onrender.com");
  process.exit(1);
}

const template = await readFile(new URL("../openapi.template.yaml", import.meta.url), "utf8");
const rendered = template.replaceAll("__PUBLIC_BASE_URL__", baseUrl);
await writeFile(new URL("../openapi.generated.yaml", import.meta.url), rendered, "utf8");
console.log(`openapi.generated.yaml créé pour ${baseUrl}`);
