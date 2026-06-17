import re
from io import BytesIO

from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer


def _escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def text_to_pdf_bytes(text: str, title: str | None = None) -> bytes:
    """Render plain text (paragraphs separated by blank lines) as a simple PDF."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=2.5 * cm, rightMargin=2.5 * cm, topMargin=2.5 * cm, bottomMargin=2.5 * cm,
    )
    styles = getSampleStyleSheet()
    body_style = ParagraphStyle(
        "Body", parent=styles["Normal"], fontSize=10.5, leading=15, spaceAfter=8, alignment=TA_LEFT,
    )
    title_style = ParagraphStyle("LetterTitle", parent=styles["Heading2"], spaceAfter=14)

    story = []
    if title:
        story.append(Paragraph(_escape(title), title_style))

    for block in text.split("\n\n"):
        block = block.strip("\n")
        if not block:
            story.append(Spacer(1, 8))
            continue
        lines = [_escape(line) for line in block.split("\n")]
        story.append(Paragraph("<br/>".join(lines), body_style))

    doc.build(story)
    return buf.getvalue()


# ── Markdown-aware rendering (for chat replies / PV templates) ────────────────

# Inline markdown → the small HTML subset ReportLab's Paragraph understands.
# Run only AFTER _escape() so user '<' / '&' stay literal.
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
_ITALIC_RE = re.compile(r"(?<![\*_])[\*_](?!\s)(.+?)(?<!\s)[\*_](?![\*_])")
_ORDERED_RE = re.compile(r"^(\d+)[.)]\s+(.*)$")


def _inline_md(line: str) -> str:
    """Escape, then convert **bold** / *italic* / _italic_ to <b>/<i>."""
    out = _escape(line)
    out = _BOLD_RE.sub(r"<b>\1</b>", out)
    out = _ITALIC_RE.sub(r"<i>\1</i>", out)
    return out


def markdown_to_pdf_bytes(text: str, title: str | None = None) -> bytes:
    """Render a lightweight-markdown document (headings, lists, bold/italic, rules)
    as a structured PDF. Defensive: any line that matches no rule renders as a
    normal paragraph, so unexpected syntax never raises."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=2.5 * cm, rightMargin=2.5 * cm, topMargin=2.5 * cm, bottomMargin=2.5 * cm,
    )
    styles = getSampleStyleSheet()
    body_style = ParagraphStyle(
        "MdBody", parent=styles["Normal"], fontSize=10.5, leading=15, spaceAfter=8, alignment=TA_LEFT,
    )
    bullet_style = ParagraphStyle(
        "MdBullet", parent=body_style, leftIndent=16, bulletIndent=4, spaceAfter=3,
    )
    h_styles = {
        1: ParagraphStyle("MdH1", parent=styles["Heading1"], spaceBefore=12, spaceAfter=8),
        2: ParagraphStyle("MdH2", parent=styles["Heading2"], spaceBefore=10, spaceAfter=6),
        3: ParagraphStyle("MdH3", parent=styles["Heading3"], spaceBefore=8, spaceAfter=4),
    }
    doc_title_style = ParagraphStyle("MdTitle", parent=styles["Title"], spaceAfter=16)

    story: list = []
    if title:
        story.append(Paragraph(_escape(title), doc_title_style))

    # Buffer consecutive plain lines into one paragraph (so soft-wrapped text
    # joins, but headings/lists/rules flush the buffer first).
    para_lines: list[str] = []

    def flush_para() -> None:
        if para_lines:
            story.append(Paragraph("<br/>".join(para_lines), body_style))
            para_lines.clear()

    for raw in text.split("\n"):
        line = raw.rstrip()
        stripped = line.strip()

        if not stripped:
            flush_para()
            story.append(Spacer(1, 6))
            continue

        # Horizontal rule
        if stripped in ("---", "***", "___"):
            flush_para()
            story.append(Spacer(1, 4))
            story.append(HRFlowable(width="100%", thickness=0.6, color="#999999"))
            story.append(Spacer(1, 6))
            continue

        # Headings: #, ##, ###
        m = re.match(r"^(#{1,3})\s+(.*)$", stripped)
        if m:
            flush_para()
            level = len(m.group(1))
            story.append(Paragraph(_inline_md(m.group(2)), h_styles[level]))
            continue

        # Bullet list: - or *
        m = re.match(r"^[-*]\s+(.*)$", stripped)
        if m:
            flush_para()
            story.append(Paragraph(_inline_md(m.group(1)), bullet_style, bulletText="•"))
            continue

        # Ordered list: 1. / 1)
        m = _ORDERED_RE.match(stripped)
        if m:
            flush_para()
            story.append(Paragraph(_inline_md(m.group(2)), bullet_style, bulletText=f"{m.group(1)}."))
            continue

        # Plain text line → accumulate
        para_lines.append(_inline_md(line))

    flush_para()
    if not story:
        story.append(Spacer(1, 1))
    doc.build(story)
    return buf.getvalue()
