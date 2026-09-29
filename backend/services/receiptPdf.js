const PDFDocument = require('pdfkit');

// Renders a payment receipt as a PDF stream on the Company Profile letterhead
// (Settings → Company Profile) — the same letterhead quotations, proforma
// invoices and invoices print. There is no separate receipt template to keep
// in step with it.
//
// `payer` is a generic { name, subLabel, referenceLabel, referenceValue }
// shape built by the caller (routes/payments.js) — it works the same way
// whether the payment is linked to an Account/Opportunity/Quotation or is an
// older payment from before those links existed.
function generateReceiptPdf({ payment, payer, lineDescription, company }, res) {
  const c = company || {};
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const safeNumber = String(payment.payment_number || payment.id).replace(/[^\w.-]/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=Receipt-${safeNumber}.pdf`);
  doc.pipe(res);

  // Letterhead
  const name = c.trade_name || c.legal_name || 'Your Company';
  doc.fontSize(18).fillColor('#111827').text(name, { align: 'left' });
  if (c.trade_name && c.legal_name && c.trade_name !== c.legal_name) {
    doc.fontSize(9).fillColor('#4b5563').text(c.legal_name);
  }
  const addressLine = [c.address, [c.city, c.state, c.postal_code].filter(Boolean).join(', ')].filter(Boolean).join('\n');
  if (addressLine) doc.fontSize(9).fillColor('#4b5563').text(addressLine, { align: 'left' });
  const contact = [c.phone, c.email, c.website].filter(Boolean).join('  ·  ');
  if (contact) doc.fontSize(9).fillColor('#4b5563').text(contact);
  if (c.gstin) doc.fontSize(9).fillColor('#4b5563').text(`GSTIN: ${c.gstin}`);
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#d1d5db').stroke();
  doc.moveDown();

  doc.fontSize(14).fillColor('#111827').text('Payment Receipt', { align: 'center' });
  doc.moveDown();

  // Receipt meta
  const metaY = doc.y;
  doc.fontSize(10).fillColor('#374151');
  doc.text(`Receipt No: ${payment.payment_number || payment.id}`, 50, metaY);
  doc.text(`Date: ${String(payment.payment_date || payment.created_at || '').slice(0, 10)}`, 320, metaY);
  doc.moveDown(1.5);

  // Payer details — generic, works for any linked record type
  doc.fontSize(11).fillColor('#111827').text('Received From', 50, doc.y, { underline: true });
  doc.fontSize(10).fillColor('#374151');
  doc.text(`Name: ${payer.name || '-'}`);
  if (payer.subLabel) doc.text(payer.subLabel);
  if (payer.referenceLabel && payer.referenceValue) doc.text(`${payer.referenceLabel}: ${payer.referenceValue}`);
  doc.moveDown();

  // Payment table
  const tableTop = doc.y;
  doc.fontSize(10).fillColor('#111827');
  doc.text('Description', 50, tableTop, { width: 250 });
  doc.text('Installment', 300, tableTop, { width: 90 });
  doc.text('Amount (INR)', 400, tableTop, { width: 140, align: 'right' });
  doc.moveTo(50, tableTop + 16).lineTo(545, tableTop + 16).strokeColor('#d1d5db').stroke();

  const rowY = tableTop + 24;
  doc.fontSize(10).fillColor('#374151');
  doc.text(lineDescription || payment.description || 'Payment', 50, rowY, { width: 250 });
  doc.text(payment.installment_number ? `#${payment.installment_number}` : '-', 300, rowY, { width: 90 });
  doc.text(Number(payment.amount || 0).toLocaleString('en-IN'), 400, rowY, { width: 140, align: 'right' });
  doc.moveTo(50, rowY + 20).lineTo(545, rowY + 20).strokeColor('#d1d5db').stroke();

  doc.fontSize(11).fillColor('#111827').text('Total Paid:', 300, rowY + 30, { width: 90 });
  doc.text(`INR ${Number(payment.amount || 0).toLocaleString('en-IN')}`, 400, rowY + 30, { width: 140, align: 'right' });

  doc.moveDown(3);
  doc.fontSize(9).fillColor('#374151');
  doc.text(`Payment Mode: ${payment.payment_mode || '-'}`, 50);
  if (payment.transaction_number) doc.text(`Transaction No: ${payment.transaction_number}`);
  doc.text(`Status: ${payment.status}`);

  if (c.signatory_name) {
    doc.moveDown(3);
    doc.fontSize(9).fillColor('#374151').text(`For ${name}`, 50, doc.y, { align: 'right' });
    doc.moveDown(2);
    doc.text(c.signatory_name, { align: 'right' });
    doc.fontSize(8).fillColor('#6b7280').text('Authorised Signatory', { align: 'right' });
  }

  doc.moveDown(3);
  doc.fontSize(8).fillColor('#6b7280').text('This is a computer-generated receipt.', 50, doc.y, { align: 'center' });

  doc.end();
}

module.exports = { generateReceiptPdf };
