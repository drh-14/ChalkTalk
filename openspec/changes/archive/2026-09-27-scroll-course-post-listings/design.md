## Layout

The left feed is a viewport-height flex column on wide screens. The existing controls remain fixed-height children; the post listing is the flexible, overflow-scrolling child. This also keeps pagination and later-page errors adjacent to the cards they govern. The right detail pane keeps its existing sizing and page scrolling.

At 850px and below, the two-column layout already becomes a single-panel view. Remove the nested overflow there so touch and keyboard navigation follow the natural page scroll. A focusable, named region remains in the DOM for accessibility on either layout.

No client-side scroll state or extra data fetching is needed.
