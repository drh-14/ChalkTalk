CREATE TABLE semantic_post_catchup (
  post_id uuid PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE
);
