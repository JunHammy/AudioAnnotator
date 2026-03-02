import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";

// Next.js 15+ requires params to be awaited
type Params = Promise<{ path: string[] }>;

async function proxy(req: NextRequest, params: Params) {
  const { path } = await params;
  const url = new URL(`/api/${path.join("/")}`, BACKEND);
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  // Strip hop-by-hop headers that break proxying
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    if (!["host", "connection", "transfer-encoding"].includes(key.toLowerCase())) {
      headers[key] = value;
    }
  });

  // Stream the body directly — do NOT buffer with req.text() or req.arrayBuffer().
  // Streaming is essential for large binary uploads (audio files).
  // duplex: "half" is required by Node.js 18+ for streaming request bodies.
  const body = req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined;
  const res = await fetch(url.toString(), {
    method: req.method,
    headers,
    body,
    // @ts-expect-error — Node.js fetch requires duplex for streaming bodies
    duplex: "half",
  });

  const resHeaders = new Headers();
  res.headers.forEach((value, key) => {
    if (!["transfer-encoding", "connection"].includes(key.toLowerCase())) {
      resHeaders.set(key, value);
    }
  });

  return new NextResponse(res.body, { status: res.status, headers: resHeaders });
}

export const GET    = (req: NextRequest, { params }: { params: Params }) => proxy(req, params);
export const POST   = (req: NextRequest, { params }: { params: Params }) => proxy(req, params);
export const PUT    = (req: NextRequest, { params }: { params: Params }) => proxy(req, params);
export const PATCH  = (req: NextRequest, { params }: { params: Params }) => proxy(req, params);
export const DELETE = (req: NextRequest, { params }: { params: Params }) => proxy(req, params);
