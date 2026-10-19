## Context

The question detail renders its followup heading as a semantic `h2` inside `.followup-sections`. Although that section sets `font-size: 1.35rem`, the more specific `.discussion-detail article h2` rule wins and renders the heading at 31.2px in the desktop browser check.

## Goals / Non-Goals

**Goal:** Make the heading visually smaller, add breathing room above the students' answer, and place staff controls immediately below the post body.

**Non-goal:** Resize followup content, the compose prompt, answer panels, or other section headings.

## Decisions

Use a direct-child selector for the followup section heading and scale each term of its effective responsive size to 80%: `clamp(1.24rem, 2.08vw, 1.88rem)`. This leaves headings rendered inside followup bodies and editors at their original size.

The question responses originally have a 2rem top margin. Raise it to 2.2rem for about 10% more space. Put the staff action row immediately after the post body and before question responses. Restore the original `.button.compact` size and the existing flow layout for the merge search panel so it remains usable on narrow screens.

## Risks / Trade-offs

- The smaller heading may look too subtle at some viewport widths → inspect desktop and narrow browser screenshots before handoff.
- An open merge search panel pushes answers farther down → verify that flow and controls remain usable on narrow screens.
