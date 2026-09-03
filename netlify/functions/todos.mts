import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request, context: Context) => {
  const store = getStore("weekly-todo");

  if (req.method === "GET") {
    const data = (await store.get("todos", { type: "json" })) || [];
    return new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json" },
    });
  }

  if (req.method === "POST") {
    const body = await req.json();
    await store.setJSON("todos", body);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  }

  return new Response("Method Not Allowed", { status: 405 });
};

export const config = { path: "/api/todos" };
