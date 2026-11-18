import "server-only";
import { cookies } from "next/headers";
import { sql } from "./db";
import { hashSecret, newSecret } from "./crypto";
import { HttpError } from "./errors";

export const WORKSPACE_COOKIE = "fs_ws";
const MAX_AGE = 60 * 60 * 24 * 30;

export interface Workspace {
  id: string;
  name: string;
}

/**
 * Demo access model: each browser that clicks "Open demo workspace" gets its own private
 * workspace, identified by a random secret in an httpOnly cookie (only its hash is stored).
 */
export async function createWorkspace(): Promise<Workspace> {
  const secret = newSecret();
  const label = secret.slice(0, 4).toUpperCase();
  const [ws] = await sql()<Workspace[]>`
    insert into workspaces (name, session_hash) values (${`Demo workspace ${label}`}, ${hashSecret(secret)})
    returning id, name`;
  const jar = await cookies();
  jar.set(WORKSPACE_COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  return ws!;
}

export async function currentWorkspace(): Promise<Workspace | null> {
  const jar = await cookies();
  const secret = jar.get(WORKSPACE_COOKIE)?.value;
  if (!secret || secret.length > 100) return null;
  const rows = await sql()<Workspace[]>`select id, name from workspaces where session_hash = ${hashSecret(secret)}`;
  return rows[0] ?? null;
}

export async function requireWorkspace(): Promise<Workspace> {
  const ws = await currentWorkspace();
  if (!ws) throw new HttpError(401, "Your demo session has ended. Open a demo workspace from the home page.");
  return ws;
}
