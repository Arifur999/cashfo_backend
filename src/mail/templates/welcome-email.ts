export function renderWelcomeEmail(name: string): { subject: string; html: string; text: string } {
  const subject = 'Welcome to Money Management Tracker';
  const text = `Hi ${name},\n\nYour account has been created. You can now log in and start tracking your accounts, transactions, and reports.\n\n- Money Management Tracker`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #111827;">Welcome, ${name}!</h2>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">
        Your account has been created successfully. You can now log in and start tracking
        your accounts, transactions, contacts, and reports.
      </p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">Money Management Tracker</p>
    </div>
  `;
  return { subject, html, text };
}
