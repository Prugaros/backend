'use strict';

const axios = require('axios');

const MAILEROO_API_URL = 'https://smtp.maileroo.com/api/v2/emails';
const MAILEROO_BULK_API_URL = 'https://smtp.maileroo.com/api/v2/emails/bulk';

// ---------------------------------------------------------------------------
// Internal: send a single email object via Maileroo
// ---------------------------------------------------------------------------
async function _sendViaMaileroo(emailObj) {
    const apiKey = process.env.MAILEROO_API_KEY;
    const fromAddress = process.env.EMAIL_FROM_ADDRESS;
    const fromName = process.env.EMAIL_FROM_NAME || 'SCG Nails';

    if (!apiKey || !fromAddress) {
        console.error('[EMAIL] MAILEROO_API_KEY or EMAIL_FROM_ADDRESS is not set in .env');
        throw new Error('Email service is not configured.');
    }

    const payload = {
        from: { address: fromAddress, display_name: fromName },
        ...emailObj
    };

    const response = await axios.post(MAILEROO_API_URL, payload, {
        headers: {
            'X-Api-Key': apiKey,
            'Content-Type': 'application/json'
        },
        timeout: 8000
    });

    return response.data;
}

// Internal: send a batch of personalized emails in a single API call via bulk endpoint
async function _sendBulkViaMaileroo(messages, subject, html, plain) {
    const apiKey = process.env.MAILEROO_API_KEY;
    if (!apiKey) throw new Error('MAILEROO_API_KEY is not set.');

    const payload = { subject, html, plain, messages, tracking: false };

    const response = await axios.post(MAILEROO_BULK_API_URL, payload, {
        headers: {
            'X-Api-Key': apiKey,
            'Content-Type': 'application/json'
        },
        timeout: 30000 // larger timeout for bulk payloads
    });

    return response.data;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function buildOrderConfirmationEmail(recipient, payload) {
    const { consolidatedItems, subtotal, totalShipping, totalAppliedCredit, grandTotal, statusUrl } = payload;

    const itemRows = Object.values(consolidatedItems).map(item => {
        const lineTotal = (item.quantity * item.price).toFixed(2);
        return `
            <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #2a2a2a;">${item.name}</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #2a2a2a; text-align: center;">${item.quantity}</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #2a2a2a; text-align: right;">$${lineTotal}</td>
            </tr>`;
    }).join('');

    const itemPlainList = Object.values(consolidatedItems).map(item =>
        `- ${item.name} (x${item.quantity}): $${(item.quantity * item.price).toFixed(2)}`
    ).join('\n');

    const creditRow = totalAppliedCredit > 0
        ? `<tr><td colspan="2" style="padding: 4px 0; text-align: right; color: #aaa;">Store Credit Applied:</td><td style="padding: 4px 0; text-align: right; color: #aaa;">-$${totalAppliedCredit.toFixed(2)}</td></tr>`
        : '';
    const creditPlain = totalAppliedCredit > 0
        ? `\nStore Credit Applied: -$${totalAppliedCredit.toFixed(2)}`
        : '';

    const statusLinkHtml = statusUrl
        ? `<p style="margin-top: 24px;"><a href="${statusUrl}" style="color: #c084fc; text-decoration: none;">View your order status →</a></p>`
        : '';
    const statusLinkPlain = statusUrl
        ? `\nView your order status: ${statusUrl}`
        : '';

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:0; background-color:#0f0f0f; font-family: Arial, sans-serif; color: #e5e7eb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0f0f; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a1a1a; border-radius: 12px; padding: 40px; max-width: 600px;">
          <tr>
            <td>
              <h1 style="color:#c084fc; margin: 0 0 8px 0; font-size: 24px;">Payment Confirmed ✅</h1>
              <p style="color:#9ca3af; margin: 0 0 32px 0;">Hi ${recipient.name || 'there'}, your payment has been received. Here's your order summary.</p>

              <table width="100%" cellpadding="0" cellspacing="0">
                <thead>
                  <tr style="color:#9ca3af; font-size: 13px; text-transform: uppercase;">
                    <th style="padding: 8px 0; text-align: left;">Item</th>
                    <th style="padding: 8px 0; text-align: center;">Qty</th>
                    <th style="padding: 8px 0; text-align: right;">Total</th>
                  </tr>
                </thead>
                <tbody>${itemRows}</tbody>
                <tfoot>
                  <tr><td colspan="2" style="padding: 12px 0 4px 0; text-align: right; color:#9ca3af;">Subtotal:</td><td style="padding: 12px 0 4px 0; text-align: right;">$${subtotal.toFixed(2)}</td></tr>
                  <tr><td colspan="2" style="padding: 4px 0; text-align: right; color:#9ca3af;">Shipping:</td><td style="padding: 4px 0; text-align: right;">$${totalShipping.toFixed(2)}</td></tr>
                  ${creditRow}
                  <tr style="font-weight: bold; font-size: 16px;">
                    <td colspan="2" style="padding: 12px 0 0 0; text-align: right; border-top: 1px solid #333;">Total Paid:</td>
                    <td style="padding: 12px 0 0 0; text-align: right; border-top: 1px solid #333; color: #c084fc;">$${grandTotal.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>

              ${statusLinkHtml}

              <p style="margin-top: 32px; color:#6b7280; font-size: 13px;">
                Questions? Message us on Facebook: <a href="https://m.me/naomi.seijo.2025" style="color:#c084fc;">m.me/naomi.seijo.2025</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const plain = `Payment Confirmed!

Hi ${recipient.name || 'there'}, your payment has been received. Here's your order summary:

${itemPlainList}

Subtotal: $${subtotal.toFixed(2)}
Shipping: $${totalShipping.toFixed(2)}${creditPlain}
Total Paid: $${grandTotal.toFixed(2)}${statusLinkPlain}

Questions? Message us at https://m.me/naomi.seijo.2025`;

    return {
        subject: 'Your order is confirmed! ✅',
        html,
        plain
    };
}

function buildRefundNoticeEmail(recipient, payload) {
    const { productName, quantity, amount } = payload;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:0; background-color:#0f0f0f; font-family: Arial, sans-serif; color: #e5e7eb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0f0f; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a1a1a; border-radius: 12px; padding: 40px; max-width: 600px;">
          <tr>
            <td>
              <h1 style="color:#c084fc; margin: 0 0 8px 0; font-size: 24px;">Refund Processed</h1>
              <p style="color:#9ca3af; margin: 0 0 32px 0;">Hi ${recipient.name || 'there'}, a cash refund has been processed for your order.</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#111; border-radius: 8px; padding: 24px;">
                <tr><td style="color:#9ca3af; padding-bottom: 8px;">Product</td><td style="text-align:right; padding-bottom: 8px;">${productName}</td></tr>
                <tr><td style="color:#9ca3af; padding-bottom: 8px;">Quantity</td><td style="text-align:right; padding-bottom: 8px;">${quantity}</td></tr>
                <tr style="font-weight:bold;"><td style="padding-top: 8px; border-top: 1px solid #2a2a2a; color:#c084fc;">Refund Amount</td><td style="text-align:right; padding-top: 8px; border-top: 1px solid #2a2a2a; color:#c084fc;">$${amount.toFixed(2)}</td></tr>
              </table>
              <p style="margin-top: 32px; color:#6b7280; font-size: 13px;">
                Questions? Message us on Facebook: <a href="https://m.me/naomi.seijo.2025" style="color:#c084fc;">m.me/naomi.seijo.2025</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const plain = `Refund Processed

Hi ${recipient.name || 'there'}, a cash refund has been processed for your order.

Product: ${productName}
Quantity: ${quantity}
Refund Amount: $${amount.toFixed(2)}

Questions? Message us at https://m.me/naomi.seijo.2025`;

    return {
        subject: 'Your refund has been processed',
        html,
        plain
    };
}

function buildGroupOrderOpenEmail(recipient, payload) {
    // Uses Maileroo {{ }} template variables so this template works for both
    // single sends (sendTransactionalEmail) and bulk sends (sendBroadcastEmail).
    // When called directly, recipient/payload values are interpolated by JS.
    // When used via bulk endpoint, Maileroo substitutes {{ variables }} from template_data.
    const firstName = recipient.name ? recipient.name.split(' ')[0] : 'there';
    const { groupOrderName, shopUrl, dateRangeTitle, emailCustomMessage, featuredImageUrl } = payload;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:0; background-color:#0f0f0f; font-family: Arial, sans-serif; color: #e5e7eb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0f0f; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a1a1a; border-radius: 12px; padding: 40px; max-width: 600px;">
          <tr>
            <td>
              ${featuredImageUrl ? `<img src="${featuredImageUrl}" alt="Group Order Banner" style="width: 100%; border-radius: 12px; margin-bottom: 24px;" />` : ''}
              <h1 style="color:#c084fc; margin: 0 0 8px 0; font-size: 24px;">🛍️ ${dateRangeTitle}</h1>
              <p style="color:#9ca3af; margin: 0 0 16px 0;">Hi ${firstName}! A new group order is open and ready to shop.</p>
              ${emailCustomMessage ? `<p style="color:#e5e7eb; margin: 0 0 32px 0; white-space: pre-wrap;">${emailCustomMessage}</p>` : '<div style="margin-bottom: 32px;"></div>'}
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#111; border-radius: 8px; padding: 24px; margin-bottom: 32px;">
                <tr><td>
                  <p style="margin: 0 0 6px 0; color:#9ca3af; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Group Order</p>
                  <p style="margin: 0; color:#ffffff; font-size: 18px; font-weight: bold;">${groupOrderName}</p>
                </td></tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td align="center">
                  <a href="${shopUrl}" style="display: inline-block; padding: 14px 32px; background-color: #c084fc; color: #0f0f0f; font-weight: bold; font-size: 16px; border-radius: 8px; text-decoration: none;">Shop Now →</a>
                </td></tr>
              </table>
              <p style="margin-top: 32px; color:#6b7280; font-size: 13px;">Questions? <a href="https://m.me/naomi.seijo.2025" style="color:#c084fc;">Message us on Facebook</a></p>
              <p style="margin-top: 8px; color:#4b5563; font-size: 12px;">You received this because you opted in to group order notifications. <a href="${recipient.unsubscribeUrl}" style="color:#6b7280; text-decoration:underline;">Unsubscribe</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const plainTextCustomMessage = emailCustomMessage ? `\n\n${emailCustomMessage}` : '';
    const plain = `${dateRangeTitle}\n\nHi ${firstName}! A new group order is open.${plainTextCustomMessage}\n\nGroup Order: ${groupOrderName}\nShop Now: ${shopUrl}\n\nQuestions? https://m.me/naomi.seijo.2025\n\nTo unsubscribe, click here: ${recipient.unsubscribeUrl}`;

    return { subject: `🛍️ ${dateRangeTitle}`, html, plain };
}

// Shared template for bulk sends — uses Maileroo {{ }} variable syntax
function buildGroupOrderOpenBulkTemplate(payload) {
    const { dateRangeTitle, groupOrderName, emailCustomMessage, featuredImageUrl } = payload;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:0; background-color:#0f0f0f; font-family: Arial, sans-serif; color: #e5e7eb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0f0f; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a1a1a; border-radius: 12px; padding: 40px; max-width: 600px;">
          <tr>
            <td>
              ${featuredImageUrl ? `<img src="${featuredImageUrl}" alt="Group Order Banner" style="width: 100%; border-radius: 12px; margin-bottom: 24px;" />` : ''}
              <h1 style="color:#c084fc; margin: 0 0 8px 0; font-size: 24px;">🛍️ ${dateRangeTitle}</h1>
              <p style="color:#9ca3af; margin: 0 0 16px 0;">Hi {{ first_name }}! A new group order is open and ready to shop.</p>
              ${emailCustomMessage ? `<p style="color:#e5e7eb; margin: 0 0 32px 0; white-space: pre-wrap;">${emailCustomMessage}</p>` : '<div style="margin-bottom: 32px;"></div>'}
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#111; border-radius: 8px; padding: 24px; margin-bottom: 32px;">
                <tr><td>
                  <p style="margin: 0 0 6px 0; color:#9ca3af; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Group Order</p>
                  <p style="margin: 0; color:#ffffff; font-size: 18px; font-weight: bold;">${groupOrderName}</p>
                </td></tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td align="center">
                  <a href="{{ shop_url }}" style="display: inline-block; padding: 14px 32px; background-color: #c084fc; color: #0f0f0f; font-weight: bold; font-size: 16px; border-radius: 8px; text-decoration: none;">Shop Now →</a>
                </td></tr>
              </table>
              <p style="margin-top: 32px; color:#6b7280; font-size: 13px;">Questions? <a href="https://m.me/naomi.seijo.2025" style="color:#c084fc;">Message us on Facebook</a></p>
              <p style="margin-top: 8px; color:#4b5563; font-size: 12px;">You received this because you opted in to group order notifications. <a href="{{ unsubscribe_url }}" style="color:#6b7280; text-decoration:underline;">Unsubscribe</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const plainTextCustomMessage = emailCustomMessage ? `\n\n${emailCustomMessage}` : '';
    const plain = `${dateRangeTitle}\n\nHi {{ first_name }}! A new group order is open.${plainTextCustomMessage}\n\nGroup Order: ${groupOrderName}\nShop Now: {{ shop_url }}\n\nQuestions? https://m.me/naomi.seijo.2025\n\nTo unsubscribe, click here: {{ unsubscribe_url }}`;

    return { subject: `🛍️ ${dateRangeTitle}`, html, plain };
}

// ---------------------------------------------------------------------------
// CUSTOM_BROADCAST — fully customizable subject/body/banner
// ---------------------------------------------------------------------------
function buildCustomBroadcastEmail(recipient, payload) {
    const { subject, bodyText, featuredImageUrl, includeShopLink, shopUrl } = payload;

    const bannerHtml = featuredImageUrl
        ? `<img src="${featuredImageUrl}" alt="Banner" style="width: 100%; border-radius: 12px; margin-bottom: 24px;" />`
        : '';

    const bodyHtml = bodyText
        ? `<p style="color:#e5e7eb; margin: 0 0 32px 0; white-space: pre-wrap;">${bodyText}</p>`
        : '';

    const shopButtonHtml = (includeShopLink && shopUrl)
        ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 32px;">
             <tr><td align="center">
               <a href="${shopUrl}" style="display: inline-block; padding: 14px 32px; background-color: #c084fc; color: #0f0f0f; font-weight: bold; font-size: 16px; border-radius: 8px; text-decoration: none;">Shop Now →</a>
             </td></tr>
           </table>`
        : '';

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:0; background-color:#0f0f0f; font-family: Arial, sans-serif; color: #e5e7eb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0f0f; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a1a1a; border-radius: 12px; padding: 40px; max-width: 600px;">
          <tr>
            <td>
              ${bannerHtml}
              ${bodyHtml}
              ${shopButtonHtml}
              <p style="margin-top: 32px; color:#6b7280; font-size: 13px;">Questions? <a href="https://m.me/naomi.seijo.2025" style="color:#c084fc;">Message us on Facebook</a></p>
              <p style="margin-top: 8px; color:#4b5563; font-size: 12px;">You received this because you opted in to group order notifications. <a href="${recipient.unsubscribeUrl}" style="color:#6b7280; text-decoration:underline;">Unsubscribe</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const shopLinkPlain = (includeShopLink && shopUrl) ? `\n\nShop Now: ${shopUrl}` : '';
    const plain = `${bodyText || ''}${shopLinkPlain}\n\nQuestions? https://m.me/naomi.seijo.2025\n\nTo unsubscribe: ${recipient.unsubscribeUrl}`;

    return { subject, html, plain };
}

// Bulk variant — uses {{ }} Maileroo template variables per-recipient
function buildCustomBroadcastBulkTemplate(payload) {
    const { subject, bodyText, featuredImageUrl, includeShopLink } = payload;

    const bannerHtml = featuredImageUrl
        ? `<img src="${featuredImageUrl}" alt="Banner" style="width: 100%; border-radius: 12px; margin-bottom: 24px;" />`
        : '';

    const bodyHtml = bodyText
        ? `<p style="color:#e5e7eb; margin: 0 0 32px 0; white-space: pre-wrap;">${bodyText}</p>`
        : '';

    // Only render the button block when shop links are enabled.
    // We build the template server-side so there's no risk of an empty href.
    const shopButtonHtml = includeShopLink
        ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 32px;">
             <tr><td align="center">
               <a href="{{ shop_url }}" style="display: inline-block; padding: 14px 32px; background-color: #c084fc; color: #0f0f0f; font-weight: bold; font-size: 16px; border-radius: 8px; text-decoration: none;">Shop Now \u2192</a>
             </td></tr>
           </table>`
        : '';

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:0; background-color:#0f0f0f; font-family: Arial, sans-serif; color: #e5e7eb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0f0f; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a1a1a; border-radius: 12px; padding: 40px; max-width: 600px;">
          <tr>
            <td>
              ${bannerHtml}
              ${bodyHtml}
              ${shopButtonHtml}
              <p style="margin-top: 32px; color:#6b7280; font-size: 13px;">Questions? <a href="https://m.me/naomi.seijo.2025" style="color:#c084fc;">Message us on Facebook</a></p>
              <p style="margin-top: 8px; color:#4b5563; font-size: 12px;">You received this because you opted in to group order notifications. <a href="{{ unsubscribe_url }}" style="color:#6b7280; text-decoration:underline;">Unsubscribe</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const shopLinkPlain = includeShopLink ? `\n\nShop Now: {{ shop_url }}` : '';
    const plain = `${bodyText || ''}${shopLinkPlain}\n\nQuestions? https://m.me/naomi.seijo.2025\n\nTo unsubscribe: {{ unsubscribe_url }}`;

    return { subject, html, plain };
}

// ---------------------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------------------
const TEMPLATES = {
    ORDER_CONFIRMATION:  buildOrderConfirmationEmail,
    REFUND_NOTICE:       buildRefundNoticeEmail,
    GROUP_ORDER_OPEN:    buildGroupOrderOpenEmail,
    CUSTOM_BROADCAST:    buildCustomBroadcastEmail
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a single transactional email.
 * This function is designed to be called fire-and-forget with .catch():
 *   sendTransactionalEmail(...).catch(err => console.error('[EMAIL]', err.message));
 *
 * @param {'ORDER_CONFIRMATION'|'REFUND_NOTICE'} type
 * @param {{ to: string, name?: string }} recipient
 * @param {object} payload  - Type-specific data fields
 * @returns {Promise<void>} - Throws on failure so callers can .catch()
 */
async function sendTransactionalEmail(type, recipient, payload) {
    // Guard: skip if email sending is disabled (e.g. dev environment)
    if (process.env.EMAIL_ENABLED !== 'true') {
        console.log(`[EMAIL] Skipped (EMAIL_ENABLED != true) — would have sent ${type} to ${recipient.to}`);
        return;
    }

    if (!recipient.to) {
        console.warn(`[EMAIL] Skipping ${type} — no email address provided.`);
        return;
    }

    const templateFn = TEMPLATES[type];
    if (!templateFn) {
        console.error(`[EMAIL] Unknown email type: "${type}"`);
        throw new Error(`Unknown email type: ${type}`);
    }

    const { subject, html, plain } = templateFn(recipient, payload);

    await _sendViaMaileroo({
        to: [{ address: recipient.to, display_name: recipient.name || '' }],
        subject,
        html,
        plain
    });

    console.log(`[EMAIL] ✅ Sent ${type} to ${recipient.to}`);
}

/**
 * Send a broadcast email to multiple recipients using Maileroo's bulk endpoint.
 * One API request per batch — each recipient gets a personalized email via template_data.
 *
 * @param {'GROUP_ORDER_OPEN'} type
 * @param {Array<{ to: string, name?: string, shopUrl: string }>} recipients
 * @param {object} payload  - Shared data for the template (groupOrderName, dateRangeTitle, etc.)
 * @returns {Promise<void>}
 */
async function sendBroadcastEmail(type, recipients, payload) {
    if (process.env.EMAIL_ENABLED !== 'true') {
        console.log(`[EMAIL] Skipped (EMAIL_ENABLED != true) — would have sent ${type} to ${recipients.length} recipients`);
        return;
    }

    if (!recipients || recipients.length === 0) {
        console.warn(`[EMAIL] sendBroadcastEmail called with no recipients for type ${type}`);
        return;
    }

    const fromAddress = process.env.EMAIL_FROM_ADDRESS;
    const fromName = process.env.EMAIL_FROM_NAME || 'SCG Nails';

    if (type === 'GROUP_ORDER_OPEN') {
        const { subject, html, plain } = buildGroupOrderOpenBulkTemplate(payload);

        // Build one MessageObject per recipient with their personalized template_data
        const messages = recipients.map(r => ({
            from: { address: fromAddress, display_name: fromName },
            to: [{ address: r.to, display_name: r.name || '' }],
            template_data: {
                first_name: r.name ? r.name.split(' ')[0] : 'there',
                shop_url: r.shopUrl,
                unsubscribe_url: r.unsubscribeUrl
            }
        }));

        const result = await _sendBulkViaMaileroo(messages, subject, html, plain);
        console.log(`[EMAIL] ✅ Bulk ${type} sent to ${recipients.length} recipients. Reference IDs: ${result?.data?.reference_ids?.length || 'unknown'}`);
        return;
    }

    if (type === 'CUSTOM_BROADCAST') {
        const { subject, html, plain } = buildCustomBroadcastBulkTemplate(payload);

        const messages = recipients.map(r => ({
            from: { address: fromAddress, display_name: fromName },
            to: [{ address: r.to, display_name: r.name || '' }],
            template_data: {
                unsubscribe_url: r.unsubscribeUrl,
                ...(payload.includeShopLink && r.shopUrl ? { shop_url: r.shopUrl } : {})
            }
        }));

        const result = await _sendBulkViaMaileroo(messages, subject, html, plain);
        console.log(`[EMAIL] ✅ Bulk ${type} sent to ${recipients.length} recipients.`);
        return;
    }

    console.error(`[EMAIL] Unknown broadcast type: "${type}"`);
    throw new Error(`Unknown broadcast email type: ${type}`);
}

module.exports = { sendTransactionalEmail, sendBroadcastEmail };
