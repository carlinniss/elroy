from pathlib import Path
from datetime import date
from xml.sax.saxutils import escape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
OUT = Path('D:/elroy/output/pdf')
OUT.mkdir(parents=True, exist_ok=True)
assert date(2026, 10, 5).strftime('%A') == 'Monday'
invoices = [
    ('LA_Sentinel_Propel_RTP_September_2026.pdf', 'LA Sentinel / Propel RTP Initiative', 65, 12485, [
        ('WordPress-to-Ghost migration planning and technical implementation', 'content architecture, database/content review, subscription/payment transition planning, URL preservation, redirects, media and author migration strategy', 54),
        ('LA Sentinel Jobs portal development', 'resume upload workflow, employer access, paid listing functionality, applicant/job workflow improvements and OpenClassify customization support', 39),
        ('Docker, staging and infrastructure', 'containerization, staging environment work, service troubleshooting, restart/reliability configuration and deployment planning', 20),
        ('Jobs launch/signage systems', 'QR-code job intake, signage options, signup workflow and Audience Gate/ad-block/paywall messaging implementation', 18),
        ('ADP employer integration development', "using St. John's as the initial implementation case while researching and designing a reusable ADP integration framework that can support other Sentinel Jobs employers using ADP; included API requirements, job-feed workflow, ApplicantStack review and job presentation requirements", 15),
        ('Analytics, tracking and RTP project management', 'launch measurement, event/QR tracking, implementation planning, budget/work tracking and Propel milestone documentation', 13),
        ('Initial website redesign and visual-direction planning', 'early design discussion, homepage and section structure, content hierarchy, migration-aware design requirements, user experience considerations and planning for the designer workflow and implementation process', 10),
    ], 'Services provided in support of the LA Sentinel Propel/RTP digital transformation initiative, including the jobs platform, publishing-platform modernization, reusable employer/job-system integrations, website redesign planning, audience development infrastructure, analytics and associated technical implementation.'),
    ('Taste_of_Soul_Digital_Support_September_2026.pdf', 'Taste of Soul 2026 Digital Support', 50, 1900, [
        ('Taste of Soul microsite design, page structure and content updates', '', 10),
        ('Vendor directory development and maintenance', 'including approximately 90 vendor listings and navigation/search presentation', 8),
        ("Sponsor/logo updates, promotional content and Children's Center content integration", '', 6),
        ('Mobile/responsive optimization, homepage layout adjustments and event-information presentation', '', 6),
        ('Advertising integration', 'including billboard/cube placement and Broadstreet-related site preparation', 4),
        ('Social preview, launch-readiness, QR/signage and miscellaneous event-site updates', '', 4),
    ], 'Digital production and technical support for the 2026 Taste of Soul event website and associated promotional assets.'),
    ('LA_Sentinel_Technical_Services_September_2026.pdf', 'Los Angeles Sentinel Website / Technical Services', 50, 1400, [
        ('WordPress production-site maintenance, troubleshooting and content-management support unrelated to Propel migration work', '', 8),
        ('Server, hosting, Cloudflare and production infrastructure administration', '', 6),
        ('Broadstreet / digital advertising technical support, placement troubleshooting and campaign implementation assistance', '', 5),
        ('Advertising specifications, video billboard and digital-sales technical support', '', 3),
        ('Staff technical support, website troubleshooting and miscellaneous digital operations', '', 3),
        ('Streaming, media and other production technical support', '', 3),
    ], 'Ongoing website maintenance, server administration, advertising operations and general technical support for the Los Angeles Sentinel.'),
]
invoices = invoices[:1]
navy = colors.HexColor('#19354B')
muted = colors.HexColor('#536575')
body = ParagraphStyle('body', fontName='Helvetica', fontSize=9.3, leading=12.2, textColor=navy)
small = ParagraphStyle('small', parent=body, fontSize=8.5, leading=11, textColor=muted)
title = ParagraphStyle('title', parent=body, fontName='Helvetica-Bold', fontSize=17, leading=21)
label = ParagraphStyle('label', parent=body, fontSize=9, leading=13)
num = ParagraphStyle('number', parent=body, alignment=TA_RIGHT)
white = ParagraphStyle('white', parent=body, textColor=colors.white, fontName='Helvetica-Bold', fontSize=9)
white_num = ParagraphStyle('white_num', parent=white, alignment=TA_RIGHT)
def p(s, style=body): return Paragraph(s, style)
def footer(canvas, doc):
    canvas.setStrokeColor(colors.HexColor('#D9E0E6'))
    canvas.line(42, 40, 570, 40)
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(muted)
    canvas.drawString(42, 27, 'September 2026 services')
    canvas.drawRightString(570, 27, f'Page {doc.page}')

for filename, name, rate, expected, items, note in invoices:
    hours = sum(x[2] for x in items)
    total = hours * rate + 1500
    assert total == expected
    path = OUT / filename
    doc = SimpleDocTemplate(str(path), pagesize=(612, 792), rightMargin=42, leftMargin=42, topMargin=36, bottomMargin=52, title=name + ' | September 2026 Invoice', author='', subject='Invoice dated October 5, 2026')
    story = [p('INVOICE', ParagraphStyle('kicker', parent=body, fontSize=11, leading=15, fontName='Helvetica-Bold', textColor=muted)), Spacer(1, 8), p(escape(name), title), Spacer(1, 15)]
    meta = Table([
        [p('<b>FROM</b><br/>Carl Inniss<br/>3355 George Busbee Parkway NW, Apt 1412<br/>Kennesaw, GA 30144', label), p('<b>BILL TO</b><br/>Los Angeles Sentinel<br/>3800 Crenshaw Blvd.<br/>Los Angeles, CA 90008', label)],
        [p('<b>INVOICE DATE</b><br/>Monday, October 5, 2026', label), p('<b>BILLING PERIOD</b><br/>September 1-30, 2026', label)],
        [p(f'<b>HOURLY RATE</b><br/>${rate:.2f} / hour', label), p('', label)],
    ], colWidths=[290,238])
    meta.setStyle(TableStyle([('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),10),('VALIGN',(0,0),(-1,-1),'TOP')]))
    story += [meta, Spacer(1, 8)]
    rows = [[p('WORK PERFORMED', white),p('HOURS',white_num),p('AMOUNT',white_num)]]
    for heading, description, qty in items:
        design_extra = 1500 if heading.startswith('Initial website redesign') else 0
        if design_extra:
            description += '; includes an additional $1,500 design fee'
        text = f'<b>{escape(heading)}</b>' + (f' - {escape(description)}' if description else '')
        rows.append([p(text), p(str(qty),num),p(f'${qty*rate+design_extra:,.2f}',num)])
    rows.append([p('<b>INVOICE TOTAL (USD)</b>',white),p(str(hours),white_num),p(f'${total:,.2f}',white_num)])
    table = Table(rows, colWidths=[380, 60, 88], repeatRows=1, hAlign='LEFT')
    table.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(-1,0),navy),('BACKGROUND',(0,-1),(-1,-1),navy),
        ('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),
        ('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),
        ('ROWBACKGROUNDS',(0,1),(-1,-2),[colors.HexColor('#F2F5F7'), colors.white]),
        ('LINEBELOW',(0,1),(-1,-2),0.35,colors.HexColor('#D9E0E6')),
    ]))
    story += [table,Spacer(1,12),p(escape(note),small)]
    doc.build(story,onFirstPage=footer,onLaterPages=footer)
    reader = PdfReader(path)
    assert len(reader.pages) == 1, (filename,len(reader.pages))
    text = '\n'.join(page.extract_text() for page in reader.pages)
    assert 'Monday, October 5, 2026' in text
    assert '3355 George Busbee Parkway NW, Apt 1412' in text
    assert 'Kennesaw, GA 30144' in text
    assert '3800 Crenshaw Blvd.' in text
    assert 'Los Angeles, CA 90008' in text
    assert f'${total:,.2f}' in text
    assert '$2,150.00' in text
    assert all(f'${qty*rate:,.2f}' in text for heading,_,qty in items if not heading.startswith('Initial website redesign'))
    print(f'{filename}: {hours} hours plus $1,500 design fee, ${total:,.2f}, {len(reader.pages)} page; verified')
