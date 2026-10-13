CREATE TABLE post_view_events (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id),
  post_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  viewed_at timestamptz NOT NULL DEFAULT now(),
  viewed_on date NOT NULL,
  FOREIGN KEY (course_id,post_id) REFERENCES posts(course_id,id),
  UNIQUE (course_id,post_id,user_id,viewed_on)
);
CREATE INDEX post_view_events_course_date_idx ON post_view_events(course_id,viewed_on);
CREATE INDEX post_view_events_course_user_date_idx ON post_view_events(course_id,user_id,viewed_on);

CREATE TABLE answer_contribution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id),
  answer_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  contributed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (course_id,answer_id) REFERENCES answers(course_id,id)
);
CREATE INDEX answer_contribution_events_course_date_idx ON answer_contribution_events(course_id,contributed_at);
CREATE INDEX answer_contribution_events_user_date_idx ON answer_contribution_events(course_id,user_id,contributed_at);
INSERT INTO answer_contribution_events(course_id,answer_id,user_id,contributed_at)
SELECT a.course_id,a.id,c.user_id,a.created_at FROM answers a JOIN answer_contributors c ON c.answer_id=a.id;

CREATE TABLE question_creation_daily_counts (
  course_id uuid NOT NULL REFERENCES courses(id),
  user_id uuid NOT NULL REFERENCES users(id),
  created_on date NOT NULL,
  question_count integer NOT NULL CHECK (question_count > 0),
  PRIMARY KEY (course_id,user_id,created_on)
);
INSERT INTO question_creation_daily_counts(course_id,user_id,created_on,question_count)
SELECT course_id,author_user_id,(created_at AT TIME ZONE 'UTC')::date,count(*)::int
FROM posts WHERE type='question' AND deleted_at IS NULL
GROUP BY course_id,author_user_id,(created_at AT TIME ZONE 'UTC')::date;
CREATE INDEX posts_course_type_created_idx ON posts(course_id,type,created_at);
CREATE INDEX answers_course_created_idx ON answers(course_id,created_at);
CREATE INDEX answers_post_endorsed_idx ON answers(post_id,endorsed_at) WHERE endorsed_at IS NOT NULL;
