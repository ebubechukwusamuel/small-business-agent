import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const requestedNext = request.nextUrl.searchParams.get("next");
  let next = "/dashboard";
  if (requestedNext) {
    try {
      const candidate = new URL(requestedNext, request.url);
      if (candidate.origin === new URL(request.url).origin) {
        next = \`\${candidate.pathname}\${candidate.search}\${candidate.hash}\`;
      }
    } catch {
      // Ignore malformed redirect targets and use the in-app dashboard.
    }
  }
  if (code && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  return NextResponse.redirect(new URL("/login?error=auth", request.url));
}
