"""Inject page metadata and favicon into the Walk to Mordor EDA HTML files."""

from pathlib import Path
from bs4 import BeautifulSoup

# Resolve paths relative to the repository root, not the current working directory.
ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT / "docs" / "static"

FILES_METADATA = [
    {
        "filepath": OUTPUT_DIR / "eda-two-clocks.html",
        "title": "Two Clocks — Exploratory Data Analysis | The Walk to Mordor",
        "description": (
            "An analytical exploration of real-world walking and Middle-earth "
            "chronology, examining how Bilbo's, Frodo's, and Aragorn's journeys "
            "unfold across two different timelines."
        ),
        "author": "Bryan C. Johns",
    },
    {
        "filepath": OUTPUT_DIR / "eda-walking-data.html",
        "title": "The Walking Data — Exploratory Data Analysis | The Walk to Mordor",
        "description": (
            "An exploratory analysis of personal walking data across three "
            "virtual journeys through Middle-earth, examining daily activity, "
            "walking patterns, cumulative distance, and consistency over time."
        ),
        "author": "Bryan C. Johns",
    },
]


def set_meta(soup, name, content):
    """Add or update a named meta tag, removing duplicates."""
    tags = soup.head.find_all("meta", attrs={"name": name})

    if tags:
        tags[0]["content"] = content
        for tag in tags[1:]:
            tag.decompose()
    else:
        soup.head.append(
            soup.new_tag("meta", attrs={"name": name, "content": content})
        )


def set_favicon(soup, href):
    """Add or update the favicon link, removing duplicate icon links."""
    links = soup.head.find_all(
        "link",
        rel=lambda value: value and "icon" in value,
    )

    if links:
        links[0]["href"] = href
        links[0]["type"] = "image/x-icon"
        for link in links[1:]:
            link.decompose()
    else:
        soup.head.append(
            soup.new_tag(
                "link",
                attrs={
                    "rel": "icon",
                    "type": "image/x-icon",
                    "href": href,
                },
            )
        )


def inject_metadata(meta):
    filepath = meta["filepath"]

    if not filepath.is_file():
        raise FileNotFoundError(
            f"Generated HTML file not found: {filepath}\n"
            "Run nbconvert first to generate the HTML files."
        )

    html = filepath.read_text(encoding="utf-8")
    soup = BeautifulSoup(html, "html.parser")

    # Ensure the document has a head.
    if soup.head is None:
        head = soup.new_tag("head")
        if soup.html is not None:
            soup.html.insert(0, head)
        else:
            html_tag = soup.new_tag("html")
            soup.insert(0, html_tag)
            html_tag.insert(0, head)

    # Set the page title.
    if soup.head.title:
        soup.head.title.string = meta["title"]
    else:
        title = soup.new_tag("title")
        title.string = meta["title"]
        soup.head.insert(0, title)

    set_meta(soup, "description", meta["description"])
    set_meta(soup, "author", meta["author"])

    # HTML files live in docs/static/, so this relative path points to
    # docs/static/images/favicon.ico.
    set_favicon(soup, "images/favicon.ico")

    filepath.write_text(str(soup), encoding="utf-8")
    print(f"Updated: {filepath.relative_to(ROOT)}")


def main():
    for meta in FILES_METADATA:
        inject_metadata(meta)


if __name__ == "__main__":
    main()
