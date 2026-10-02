from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from pypdf import PdfReader

OUT = Path('D:/elroy/output/pdf/LA_Sentinel_Propel_RTP_September_2026.pdf')
navy = colors.HexColor('#19354B')
muted = colors.HexColor('#536575')
body = ParagraphStyle('body', fontName='Helvetica', fontSize=9.5, leading=13, textColor=navy)
small = ParagraphStyle('small', parent=body, fontSize=9, leading=12)
title = ParagraphStyle('title', parent=body, fontName='Helvetica-Bold', fontSize=20, leading=25)
section = ParagraphStyle('section', parent=body, fontName='Helvetica-Bold', fontSize=12, leading=16, spaceAfter=8)
white = ParagraphStyle('white', parent=body, fontName='Helvetica-Bold', textColor=colors.white)
def p(s, style=body): return Paragraph(s, style)
def footer(c, doc):
    c.setStrokeColor(colors.HexColor('#D9E0E6'))
    c.line(42, 40, 570, 40)
    c.setFont('Helvetica', 8)
    c.setFillColor(muted)
    c.drawString(42, 27, 'INV-000229 | September 2026 Propel Grant services')
    c.drawRightString(570, 27, f'Page {doc.page} of 2')

story = [p('INVOICE  INV-000229', section), p('LA Sentinel / Propel Grant', title), Spacer(1,16)]
meta = Table([
    [p('<b>FROM</b><br/>Carl Inniss<br/>carl@lasentinel.net<br/>3355 George Busbee Parkway NW, Apt 1412<br/>Kennesaw, GA 30144',small), p('<b>BILL TO</b><br/>The Bakewell Company / Los Angeles Sentinel<br/>3800 Crenshaw Blvd<br/>Los Angeles, CA 90008',small)],
    [p('<b>INVOICE DATE</b><br/>October 5, 2026',small),p('<b>SERVICE PERIOD</b><br/>September 1-30, 2026',small)],
    [p('<b>TERMS</b><br/>Due on receipt',small),p('',small)],
], colWidths=[270,258])
meta.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
story += [meta, Spacer(1,5)]
rows = [[p('DESCRIPTION',white),p('BASIS',white),p('AMOUNT',white)],
        [p('September Propel hourly work'),p('169 hours x $65'),p('$10,985.00')],
        [p('Ghost redesign design work'),p('Fixed fee'),p('$1,500.00')],
        [p('TOTAL DUE (USD)',white),p('',white),p('$12,485.00',white)]]
t = Table(rows,colWidths=[286,142,100])
t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),navy),('BACKGROUND',(0,-1),(-1,-1),navy),('BACKGROUND',(0,1),(-1,2),colors.HexColor('#F2F5F7')),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9)]))
story += [t,Spacer(1,18),p('Hourly work scope',section)]
items = [
('Jobs platform, résumés and applicant workflows', 'OpenClassify development, résumé upload and privacy controls, employer résumé access, testing and launch preparation.'),
('Jobs-site infrastructure and reliability', 'Repaired the jobs test-site outage, restored services, corrected Docker restart settings, deployment support.'),
('Employer integration planning', "Reusable ADP job-feed integration planning with St. John's Community Health as the first case; requirements and planning only, not a live integration."),
('WordPress-to-Ghost migration preparation', 'Test database restore, content and media inventory, 30-article rehearsal, URL/canonical analysis, hosting and payment-transition planning; not a completed migration.'),
('Audience development and launch materials', 'Newsletter / Digital Paper signup modal specification, copy and interactive demo; Taste of Soul jobs campaign (résumé-first flyers, 24×36 sign, 4×6 handbill, QR codes and verification).'),
('Project coordination and grant delivery', 'Propel meeting preparation, stakeholder coordination, implementation planning, RTP tracker maintenance.'),
]
for i,(heading,desc) in enumerate(items,1):
    story += [p(f'<b>{i}. {escape(heading)}</b> - {escape(desc)}',small),Spacer(1,7)]
story += [PageBreak(),p('INV-000229 | SCOPE DETAIL',section),p('Ghost redesign design work',title),Spacer(1,12),p('<b>Fixed fee: $1,500.00</b>'),Spacer(1,15),p('12-page LA Sentinel redesign built in Figma ("LA Sentinel Redesign" file).'),Spacer(1,12)]
for heading,desc in [
    ('Desktop designs','Home, Section, Article, Video, Tag, Search, Events and Taste of Soul hub.'),
    ('Mobile designs','Home, Article and Taste of Soul.'),
    ('Visual systems and refinements','Separate news and event visual systems, masthead showcase slots for event promotion, accessibility contrast fixes.'),
    ('Delivery scope','Design deliverables only; no Ghost theme built or deployed.'),
]:
    story += [p(f'<b>{heading}</b><br/>{escape(desc)}'),Spacer(1,15)]
story += [Spacer(1,10),p('Excluded from this invoice',section)]
for s in [
    'The August OpenClassify customization milestone already billed on INV-000226.',
    'Taste of Soul microsite work and routine LA Sentinel maintenance, billed on separate invoices.',
    'The exploratory audio-news concept.',
    'All work from October 1 onward, including the /resume sign-up page, résumé-only launch mode, staging deploy and build fix. These belong on the October invoice.',
]:
    story += [p('- '+escape(s)),Spacer(1,10)]
doc = SimpleDocTemplate(str(OUT),pagesize=(612,792),leftMargin=42,rightMargin=42,topMargin=36,bottomMargin=53,title='INV-000229 | September 2026 Propel Grant',author='Carl Inniss')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
r=PdfReader(OUT)
assert len(r.pages)==2,len(r.pages)
text='\n'.join(x.extract_text() for x in r.pages)
for value in ['INV-000229','carl@lasentinel.net','Due on receipt','$12,485.00','$10,985.00','$1,500.00','169 hours x $65','October 5, 2026','30-article rehearsal','no Ghost theme built or deployed','INV-000226']:
    assert value in text,value
assert 169*65+1500 == 12485
print('Verified: two pages, billing details, scope, exclusions and $12,485 total.')
