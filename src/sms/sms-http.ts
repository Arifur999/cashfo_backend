import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

// One call to MRAM over IPv4 only. MRAM sits behind Cloudflare, which also
// answers on IPv6, and MRAM allows senders by IPv4 address: a server that
// reaches it over IPv6 is refused with 1016 ("IP address not allowed") even
// when its IPv4 address is on the list. Node's fetch can't be told the
// address family, so this uses node:https.
export const ipv4Request = (url: string, options: { body?: URLSearchParams; timeoutMs: number }): Promise<{ status: number; text: string }> =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const send = target.protocol === 'http:' ? httpRequest : httpsRequest;
    const req = send(
      target,
      {
        method: options.body ? 'POST' : 'GET',
        family: 4,
        timeout: options.timeoutMs,
        headers: options.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {},
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('MRAM did not answer in time')));
    req.on('error', reject);
    if (options.body) req.write(options.body.toString());
    req.end();
  });
