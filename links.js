/* ---------------------------------------------------------------
   links.js — arrows between cards on the board.

   A link is three fields: from, to, and what you claim the
   relationship is. Drag the dot at the bottom-right of a card onto
   another card. Click the label on a line to change the relation,
   click the x to remove it.

   The relations are deliberately few. The value is in you asserting
   that two passages are connected and saying how — not in a rich
   taxonomy you'd spend your reading time navigating.
   --------------------------------------------------------------- */

const SVG_NS = "http://www.w3.org/2000/svg";

const linkDrag = { active: false, fromId: null, ghost: null };


/* =============================================================
   GEOMETRY

   Anchor each end to the nearest edge midpoint of its card, so a
   line leaves from the side that faces the other card rather than
   cutting across it.
   ============================================================= */

function cardBox(markId) {
  const el = $("boardinner")?.querySelector(`[data-board="${markId}"]`);
  if (!el) return null;
  return {
    x: parseFloat(el.style.left),
    y: parseFloat(el.style.top),
    w: el.offsetWidth,
    h: el.offsetHeight,
  };
}

function anchorPair(a, b) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };

  const horizontal = Math.abs(bc.x - ac.x) > Math.abs(bc.y - ac.y);

  if (horizontal) {
    const goingRight = bc.x > ac.x;
    return [
      { x: goingRight ? a.x + a.w : a.x, y: ac.y },
      { x: goingRight ? b.x : b.x + b.w, y: bc.y },
      "h",
    ];
  }
  const goingDown = bc.y > ac.y;
  return [
    { x: ac.x, y: goingDown ? a.y + a.h : a.y },
    { x: bc.x, y: goingDown ? b.y : b.y + b.h },
    "v",
  ];
}

function curve(p1, p2, axis) {
  // a gentle S, bowed along whichever axis the link runs
  const bend = axis === "h"
    ? Math.max(40, Math.abs(p2.x - p1.x) * 0.42)
    : Math.max(40, Math.abs(p2.y - p1.y) * 0.42);

  const c1 = axis === "h" ? { x: p1.x + bend, y: p1.y } : { x: p1.x, y: p1.y + bend };
  const c2 = axis === "h" ? { x: p2.x - bend, y: p2.y } : { x: p2.x, y: p2.y - bend };

  return `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
}


/* =============================================================
   DRAWING
   ============================================================= */

function drawLinks() {
  const svg = $("linklayer");
  if (!svg) return;

  svg.innerHTML = `
    <defs>
      ${RELATIONS.map((r) => `
        <marker id="arrow-${r.id}" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="${r.color}"></path>
        </marker>`).join("")}
    </defs>`;

  for (const link of state.links) {
    const a = cardBox(link.from);
    const b = cardBox(link.to);
    if (!a || !b) continue;           // either end filtered out or deleted

    const relation = relationOf(link.relation);
    const [p1, p2, axis] = anchorPair(a, b);

    // a wide invisible path first, so the line is easy to click
    const hit = document.createElementNS(SVG_NS, "path");
    hit.setAttribute("d", curve(p1, p2, axis));
    hit.setAttribute("class", "linkhit");
    hit.dataset.link = link.id;
    svg.appendChild(hit);

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", curve(p1, p2, axis));
    path.setAttribute("class", "linkpath");
    path.setAttribute("stroke", relation.color);
    path.setAttribute("marker-end", `url(#arrow-${relation.id})`);
    if (link.relation === "contradicts") path.setAttribute("stroke-dasharray", "6 4");
    svg.appendChild(path);

    // the label sits at the midpoint and is the control surface
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const width = relation.label.length * 6.2 + 26;

    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("class", "linklabel");
    group.setAttribute("transform", `translate(${mid.x - width / 2}, ${mid.y - 11})`);

    const chip = document.createElementNS(SVG_NS, "rect");
    chip.setAttribute("width", width);
    chip.setAttribute("height", 22);
    chip.setAttribute("rx", 11);
    chip.setAttribute("fill", "#fff");
    chip.setAttribute("stroke", relation.color);
    group.appendChild(chip);

    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", 10);
    text.setAttribute("y", 15);
    text.setAttribute("fill", relation.color);
    text.textContent = relation.label;
    text.dataset.cycle = link.id;
    group.appendChild(text);

    const close = document.createElementNS(SVG_NS, "text");
    close.setAttribute("x", width - 13);
    close.setAttribute("y", 15);
    close.setAttribute("fill", "#A1A1AA");
    close.setAttribute("class", "linkclose");
    close.textContent = "×";
    close.dataset.unlink = link.id;
    group.appendChild(close);

    svg.appendChild(group);
  }

  svg.querySelectorAll("[data-cycle]").forEach((el) =>
    el.addEventListener("click", () => cycleRelation(el.dataset.cycle)));
  svg.querySelectorAll("[data-unlink]").forEach((el) =>
    el.addEventListener("click", () => removeLink(el.dataset.unlink)));
}


/* =============================================================
   MAKING A LINK
   ============================================================= */

function wireLinking(inner) {
  inner.querySelectorAll("[data-knob]").forEach((knob) => {
    knob.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();

      linkDrag.active = true;
      linkDrag.fromId = knob.dataset.knob;
      knob.setPointerCapture(e.pointerId);

      const svg = $("linklayer");
      linkDrag.ghost = document.createElementNS(SVG_NS, "path");
      linkDrag.ghost.setAttribute("class", "linkghost");
      svg.appendChild(linkDrag.ghost);
    });

    knob.addEventListener("pointermove", (e) => {
      if (!linkDrag.active) return;
      const bounds = inner.getBoundingClientRect();
      const from = cardBox(linkDrag.fromId);
      if (!from) return;
      const p1 = { x: from.x + from.w, y: from.y + from.h - 14 };
      const p2 = { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
      linkDrag.ghost.setAttribute("d", curve(p1, p2, "h"));

      // light up whatever card is under the cursor
      inner.querySelectorAll("[data-board]").forEach((c) => c.classList.remove("linktarget"));
      const over = document.elementFromPoint(e.clientX, e.clientY);
      const card = over && over.closest("[data-board]");
      if (card && card.dataset.board !== linkDrag.fromId) card.classList.add("linktarget");
    });

    knob.addEventListener("pointerup", (e) => {
      if (!linkDrag.active) return;
      linkDrag.active = false;
      if (linkDrag.ghost) { linkDrag.ghost.remove(); linkDrag.ghost = null; }
      inner.querySelectorAll("[data-board]").forEach((c) => c.classList.remove("linktarget"));

      const over = document.elementFromPoint(e.clientX, e.clientY);
      const card = over && over.closest("[data-board]");
      if (!card) return;

      const toId = card.dataset.board;
      if (toId === linkDrag.fromId) return;
      addLink(linkDrag.fromId, toId);
    });
  });
}

function addLink(fromId, toId) {
  const already = state.links.some(
    (l) => (l.from === fromId && l.to === toId) || (l.from === toId && l.to === fromId));
  if (already) { toast("Those are already linked"); return; }

  snapshot("add link");
  state.links.push({
    id: makeId(), from: fromId, to: toId,
    relation: "plain", createdAt: Date.now(),
  });
  saveMarks();
  renderBoard();
  renderDesk();
}

function cycleRelation(linkId) {
  const link = state.links.find((l) => l.id === linkId);
  if (!link) return;
  snapshot("change relation");
  const index = RELATIONS.findIndex((r) => r.id === link.relation);
  link.relation = RELATIONS[(index + 1) % RELATIONS.length].id;
  saveMarks();
  drawLinks();
}

function removeLink(linkId) {
  snapshot("remove link");
  tombstone(linkId);
  state.links = state.links.filter((l) => l.id !== linkId);
  saveMarks();
  drawLinks();
  renderDesk();
}
