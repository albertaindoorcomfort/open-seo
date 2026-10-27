// The box's nginx sets X-Real-IP and X-Forwarded-For on every request it
// proxies, and the local callers (the cron timer, the platform on the same
// box) send neither. A machine route that sees one answers as if it did not
// exist, even if an nginx path rule is ever missed.
export function arrivedThroughProxy(request: Request): boolean {
  return (
    request.headers.has("x-forwarded-for") || request.headers.has("x-real-ip")
  );
}
