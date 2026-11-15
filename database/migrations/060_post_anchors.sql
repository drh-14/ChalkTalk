-- A question or note anchored to a box on one page of a course PDF. The anchor
-- pins the immutable file the author saw, so replacing the resource's file
-- never moves it; its status is derived when posts are read.
CREATE TABLE post_anchors (
 post_id uuid PRIMARY KEY,
 course_id uuid NOT NULL,
 resource_id uuid NOT NULL,
 file_id uuid NOT NULL,
 page integer NOT NULL CHECK(page BETWEEN 1 AND 10000),
 box_x double precision NOT NULL CHECK(box_x >= 0 AND box_x <= 1),
 box_y double precision NOT NULL CHECK(box_y >= 0 AND box_y <= 1),
 box_width double precision NOT NULL CHECK(box_width >= 0.01 AND box_width <= 1),
 box_height double precision NOT NULL CHECK(box_height >= 0.01 AND box_height <= 1),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(course_id,post_id) REFERENCES posts(course_id,id) ON DELETE CASCADE,
 FOREIGN KEY(course_id,resource_id) REFERENCES course_resources(course_id,id) ON DELETE CASCADE,
 FOREIGN KEY(course_id,file_id) REFERENCES course_files(course_id,id) ON DELETE CASCADE,
 -- A tiny tolerance absorbs floating-point rounding from the browser.
 CHECK(box_x + box_width <= 1.000001),
 CHECK(box_y + box_height <= 1.000001)
);
CREATE INDEX post_anchors_course_file_page_idx ON post_anchors(course_id,file_id,page);
CREATE INDEX post_anchors_course_resource_idx ON post_anchors(course_id,resource_id);
