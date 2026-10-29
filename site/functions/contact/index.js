// Helisika contact form handler — Cloudflare Pages Function.
// Serves the static page for GET; intercepts form POSTs and emails them via Resend.
// Recipients: info@helisikahelicopters.co.nz + phil@wasabi.ws
// Sender: Helisika Website <forms@helisikahelicopters.co.nz> (Resend-verified domain)

const TO = ['info@helisikahelicopters.co.nz', 'phil@wasabi.ws'];
const FROM = 'Helisika Website <forms@helisikahelicopters.co.nz>';

export async function onRequestPost(context) {
  const env = context.env;
  let form;
  try {
    form = await context.request.formData();
  } catch {
    return json({ ok: false, error: 'Could not read form data' }, 400);
  }

  const get = (k) => {
    const v = form.get(k);
    return typeof v === 'string' ? v.trim() : '';
  };

  const data = {
    first: get('item_meta[1]'),
    last: get('item_meta[2]'),
    company: get('item_meta[6]'),
    phone: get('item_meta[8]'),
    message: get('item_meta[5]'),
    email: get('item_meta[3]'),
    confirmEmail: get('item_meta[conf_3]'),
    service: get('item_meta[7]') || get('item_meta[other][7]'),
    honeypot: get('item_meta[10]'),
    page: get('_wp_http_referer') || 'contact page',
  };

  // Honeypot filled => bot. Pretend success, send nothing.
  if (data.honeypot) return json({ ok: true });

  // Validation (mirror the client-side rules)
  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  }
  if (data.confirmEmail && data.confirmEmail !== data.email) {
    return json({ ok: false, error: 'Email addresses do not match.' }, 400);
  }
  if (!data.message) {
    return json({ ok: false, error: 'Your Message cannot be blank.' }, 400);
  }

  const name = [data.first, data.last].filter(Boolean).join(' ') || 'Unknown';
  const subject = `Website enquiry: ${data.service ? data.service + ' — ' : ''}${name}`;

  const lines = [
    `New enquiry from the Helisika website (${data.page}).`,
    '',
    `Name: ${name}`,
    data.company ? `Company: ${data.company}` : null,
    `Email: ${data.email}`,
    data.phone ? `Phone: ${data.phone}` : null,
    data.service ? `Service: ${data.service}` : null,
    '',
    'Message:',
    data.message,
    '',
    '--',
    'Sent automatically from helisikahelicopters.co.nz',
  ].filter((l) => l !== null);

  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not set — enquiry NOT emailed:', data.email);
    return json({ ok: false, error: 'Email service is not configured yet. Please phone the office directly.' }, 500);
  }

  let sent = false;
  let sendError = '';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: TO,
        reply_to: data.email,
        subject,
        text: lines.join('\n'),
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (r.ok && (body.id || body.messageId)) {
      sent = true;
    } else {
      sendError = `Resend ${r.status}: ${JSON.stringify(body).slice(0, 300)}`;
    }
  } catch (e) {
    sendError = `Resend fetch failed: ${e.message}`;
  }

  if (!sent) {
    console.error('Failed to send enquiry email:', sendError);
    return json({ ok: false, error: 'Sorry, we could not send your message. Please phone the office directly.' }, 502);
  }

  console.log(`Enquiry emailed from ${data.email} (${name})`);
  return json({ ok: true });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
