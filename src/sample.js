import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Generates a demo PDF: a fillable (AcroForm) section and a printed, non-fillable section.
export async function createSamplePdf() {
  const doc = await PDFDocument.create();
  doc.setTitle('Sample registration form');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  const ink = rgb(0.13, 0.15, 0.2);
  const muted = rgb(0.45, 0.47, 0.52);
  const line = rgb(0.6, 0.62, 0.66);

  const text = (t, x, y, size = 11, f = font, color = ink) => page.drawText(t, { x, y, size, font: f, color });

  text('Community Center — Membership Form', 50, 740, 20, bold);
  text('Sample document for trying the editor. Nothing you do here leaves your browser.', 50, 720, 10, font, muted);

  // ---- Part A: fillable fields ----
  page.drawRectangle({ x: 40, y: 455, width: 532, height: 245, borderColor: rgb(0.85, 0.87, 0.9), borderWidth: 1 });
  text('Part A — Fillable fields (click a field and type)', 50, 680, 12, bold);

  text('Full name', 50, 652);
  const name = form.createTextField('applicant.name');
  name.addToPage(page, { x: 150, y: 645, width: 400, height: 20 });
  name.setFontSize(11);

  text('Email', 50, 622);
  const email = form.createTextField('applicant.email');
  email.addToPage(page, { x: 150, y: 615, width: 400, height: 20 });
  email.setFontSize(11);

  text('Country', 50, 592);
  const country = form.createDropdown('applicant.country');
  country.addOptions(['Canada', 'Pakistan', 'United Kingdom', 'United States', 'Other']);
  country.addToPage(page, { x: 150, y: 585, width: 180, height: 20 });
  country.setFontSize(11);

  text('Plan', 50, 560);
  const plan = form.createRadioGroup('membership.plan');
  [['Basic', 150], ['Family', 250], ['Premium', 350]].forEach(([label, x]) => {
    plan.addOptionToPage(label, page, { x, y: 556, width: 14, height: 14 });
    text(label, x + 20, 559);
  });

  const news = form.createCheckBox('membership.newsletter');
  news.addToPage(page, { x: 150, y: 526, width: 14, height: 14 });
  text('Send me the monthly newsletter', 172, 529);

  text('Notes', 50, 498);
  const notes = form.createTextField('applicant.notes');
  notes.enableMultiline();
  notes.addToPage(page, { x: 150, y: 465, width: 400, height: 44 });
  notes.setFontSize(10);

  // ---- Part B: printed (flat) form ----
  text('Part B — Printed form (not fillable: use Text, Check and Dot tools)', 50, 420, 12, bold);

  const field = (label, y, x2 = 560) => {
    text(label, 50, y);
    page.drawLine({ start: { x: 160, y: y - 3 }, end: { x: x2, y: y - 3 }, thickness: 0.8, color: line });
  };
  field('Emergency contact', 392);
  field('Phone number', 364);

  text('Preferred days', 50, 334);
  ['Mon', 'Wed', 'Fri', 'Sat'].forEach((d, i) => {
    const x = 160 + i * 80;
    page.drawRectangle({ x, y: 331, width: 12, height: 12, borderColor: ink, borderWidth: 1 });
    text(d, x + 18, 333);
  });

  text('Experience', 50, 304);
  ['Beginner', 'Intermediate', 'Advanced'].forEach((d, i) => {
    const x = 166 + i * 110;
    page.drawCircle({ x, y: 307, size: 6, borderColor: ink, borderWidth: 1 });
    text(d, x + 12, 303);
  });

  text('I confirm the information above is correct.', 50, 250, 10, font, muted);
  text('Signature', 50, 200);
  page.drawLine({ start: { x: 120, y: 197 }, end: { x: 330, y: 197 }, thickness: 0.8, color: line });
  text('Date', 360, 200);
  page.drawLine({ start: { x: 395, y: 197 }, end: { x: 560, y: 197 }, thickness: 0.8, color: line });
  text('Initials', 50, 160);
  page.drawRectangle({ x: 110, y: 148, width: 60, height: 30, borderColor: line, borderWidth: 0.8 });

  return doc.save();
}
