import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { getActor, HttpError, assertSameOrigin, type Actor } from './auth';

export type Handler = (request: NextRequest, actor: Actor) => Promise<Response>;

export function json(data: unknown, status=200): NextResponse {
  return NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
}

export function api(handler: Handler): (request: NextRequest) => Promise<Response> {
  return async request => {
    try {
      if (!['GET','HEAD','OPTIONS'].includes(request.method)) assertSameOrigin(request);
      const actor=await getActor();
      if(!actor) throw new HttpError(401,'Please sign in');
      if(actor.must_change_password && request.nextUrl.pathname!=='/api/auth/me')
        throw new HttpError(403,'Change your temporary password in My Profile before continuing');
      return await handler(request,actor);
    } catch(error) {
      if(error instanceof HttpError) return json({error:error.message},error.status);
      if(error instanceof ZodError) return json({error:'Validation failed',issues:error.issues},400);
      if(error instanceof SyntaxError) return json({error:'Invalid request body'},400);
      console.error('[api] request failed',error);
      return json({error:'An unexpected server error occurred'},500);
    }
  };
}

export async function body(request: NextRequest): Promise<Record<string,unknown>> {
  const input=await request.json();
  if(!input || typeof input!=='object' || Array.isArray(input)) throw new HttpError(400,'Expected JSON object');
  return input as Record<string,unknown>;
}

export function pageLimit(request: NextRequest) {
  const requestedLimit=Number(request.nextUrl.searchParams.get('limit') || 50);
  const requestedPage=Number(request.nextUrl.searchParams.get('page') || 1);
  const limit=Number.isInteger(requestedLimit)?Math.min(Math.max(requestedLimit,1),100):50;
  const page=Number.isInteger(requestedPage)?Math.min(Math.max(requestedPage,1),10000):1;
  return {limit,page,offset:(page-1)*limit};
}
