// Stores waitlist emails in data/waitlist.csv. Run with: node server/waitlist.mjs
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";

const FILE = new URL("../data/waitlist.csv", import.meta.url);
const PORT = process.env.PORT ?? 8787;
const EMAIL = /^[^\s@,"]+@[^\s@,"]+\.[^\s@,"]+$/;

const reply = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/api/waitlist") return reply(res, 404, { error: "Not found" });
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 1000) req.destroy();
  });
  req.on("end", async () => {
    try {
      const email = String(JSON.parse(raw).email ?? "").trim().toLowerCase();
      if (email.length > 254 || !EMAIL.test(email)) return reply(res, 400, { error: "Invalid email" });
      await mkdir(new URL("./", FILE), { recursive: true });
      const existing = await readFile(FILE, "utf8").catch(() => "");
      if (!existing.split("\n").some((line) => line.startsWith(`${email},`))) {
        await appendFile(FILE, `${email},${new Date().toISOString()}\n`);
      }
      reply(res, 200, { ok: true });
    } catch {
      reply(res, 400, { error: "Bad request" });
    }
  });
}).listen(PORT, () => console.log(`Waitlist server on http://localhost:${PORT}`));
