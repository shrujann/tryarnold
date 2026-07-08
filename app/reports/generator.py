"""PDF report generation.

Charts are rendered with matplotlib (Agg backend) and laid out with reportlab
— both pure-Python-friendly, so no system libraries (cairo/pango) are needed.
Returns raw PDF bytes ready to send as a Telegram document.
"""
from __future__ import annotations

import io
from datetime import datetime

import matplotlib

matplotlib.use("Agg")  # headless; must precede pyplot import
import matplotlib.pyplot as plt  # noqa: E402
from reportlab.lib import colors  # noqa: E402
from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.lib.styles import getSampleStyleSheet  # noqa: E402
from reportlab.lib.units import cm  # noqa: E402
from reportlab.platypus import (  # noqa: E402
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import User
from app.schemas.nutrition import DailyTotals
from app.services import progress


def _macro_bar_chart(totals: DailyTotals) -> io.BytesIO:
    fig, ax = plt.subplots(figsize=(5, 2.6))
    labels = ["Protein", "Carbs", "Fat"]
    values = [totals.protein_g, totals.carbs_g, totals.fat_g]
    ax.bar(labels, values, color=["#4C9F70", "#E0A458", "#D65780"])
    ax.set_ylabel("grams")
    ax.set_title("Macros today")
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150)
    plt.close(fig)
    buf.seek(0)
    return buf


def _weekly_calories_chart(week: list[DailyTotals]) -> io.BytesIO:
    fig, ax = plt.subplots(figsize=(5.5, 2.8))
    days = [d.date[5:] for d in week]  # MM-DD
    cals = [d.calories for d in week]
    ax.plot(days, cals, marker="o", color="#4C9F70")
    if week and week[0].target_calories:
        ax.axhline(week[0].target_calories, color="#D65780", linestyle="--", label="target")
        ax.legend()
    ax.set_ylabel("kcal")
    ax.set_title("Calories, last 7 days")
    fig.autofmt_xdate(rotation=30)
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150)
    plt.close(fig)
    buf.seek(0)
    return buf


def _totals_table(totals: DailyTotals) -> Table:
    def cell(value, target):
        return f"{round(value)}" + (f" / {target}" if target else "")

    data = [
        ["Metric", "Value"],
        ["Calories", cell(totals.calories, totals.target_calories)],
        ["Protein (g)", cell(totals.protein_g, totals.target_protein_g)],
        ["Carbs (g)", cell(totals.carbs_g, totals.target_carbs_g)],
        ["Fat (g)", cell(totals.fat_g, totals.target_fat_g)],
        ["Meals logged", str(totals.meals)],
        ["Workouts", f"{totals.workouts} ({totals.workout_minutes} min)"],
    ]
    table = Table(data, colWidths=[6 * cm, 6 * cm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#4C9F70")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F2F7F4")]),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("PADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def _render(elements) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title="Fitness Report")
    doc.build(elements)
    buf.seek(0)
    return buf.getvalue()


async def build_daily_report_pdf(
    session: AsyncSession, user: User
) -> tuple[bytes, str]:
    totals = await progress.daily_totals(session, user)
    styles = getSampleStyleSheet()
    name = user.first_name or "there"

    elements = [
        Paragraph("Daily Fitness Report", styles["Title"]),
        Paragraph(
            f"For {name} — {totals.date}", styles["Normal"]
        ),
        Spacer(1, 0.5 * cm),
    ]
    if user.goal_summary:
        elements.append(Paragraph(f"<b>Goal:</b> {user.goal_summary}", styles["Normal"]))
        elements.append(Spacer(1, 0.3 * cm))
    elements.append(_totals_table(totals))
    elements.append(Spacer(1, 0.6 * cm))
    elements.append(Image(_macro_bar_chart(totals), width=13 * cm, height=6.8 * cm))
    elements.append(Spacer(1, 0.4 * cm))
    elements.append(
        Paragraph(
            "Generated from your logged meals and workouts.", styles["Italic"]
        )
    )
    filename = f"daily-report-{totals.date}.pdf"
    return _render(elements), filename


async def build_weekly_report_pdf(
    session: AsyncSession, user: User
) -> tuple[bytes, str]:
    week = await progress.weekly_totals(session, user)
    styles = getSampleStyleSheet()
    name = user.first_name or "there"
    avg_cals = round(sum(d.calories for d in week) / len(week)) if week else 0
    total_workouts = sum(d.workouts for d in week)
    week_ending = week[-1].date if week else datetime.utcnow().strftime("%Y-%m-%d")

    elements = [
        Paragraph("Weekly Fitness Report", styles["Title"]),
        Paragraph(
            f"For {name} — week ending {week_ending}",
            styles["Normal"],
        ),
        Spacer(1, 0.4 * cm),
        Paragraph(
            f"<b>Avg daily calories:</b> {avg_cals} &nbsp;&nbsp; "
            f"<b>Total workouts:</b> {total_workouts}",
            styles["Normal"],
        ),
        Spacer(1, 0.5 * cm),
        Image(_weekly_calories_chart(week), width=14 * cm, height=7 * cm),
        Spacer(1, 0.4 * cm),
    ]

    data = [["Day", "kcal", "P", "C", "F", "Workouts"]]
    for d in week:
        data.append(
            [
                d.date[5:],
                str(round(d.calories)),
                str(round(d.protein_g)),
                str(round(d.carbs_g)),
                str(round(d.fat_g)),
                str(d.workouts),
            ]
        )
    table = Table(data, colWidths=[3 * cm, 2.5 * cm, 2 * cm, 2 * cm, 2 * cm, 2.5 * cm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#4C9F70")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("ALIGN", (1, 0), (-1, -1), "CENTER"),
            ]
        )
    )
    elements.append(table)
    filename = f"weekly-report-{week[-1].date if week else 'latest'}.pdf"
    return _render(elements), filename
