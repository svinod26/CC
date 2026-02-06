type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export async function sendResendEmail({ to, subject, html, text }: SendEmailInput) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  const replyTo = process.env.RESEND_REPLY_TO;

  if (!apiKey) {
    throw new Error('Missing RESEND_API_KEY');
  }
  if (!from) {
    throw new Error('Missing RESEND_FROM');
  }

  const payload: Record<string, any> = {
    from,
    to: [to],
    subject,
    html
  };
  if (text) payload.text = text;
  if (replyTo) payload.reply_to = replyTo;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend error ${res.status}: ${body}`);
  }

  return res.json();
}
