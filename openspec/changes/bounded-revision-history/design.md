# Design

The collection endpoint accepts an optional ordinal cursor and returns `{data,page:{nextCursor}}`. Each page contains at most 50 metadata records without title or body text. A shared revision store performs the bounded metadata query and a targeted UUID query for single and comparison reads. Services authorize the current resource before either store query. The UI fetches a revision when its disclosure opens and loads later metadata pages explicitly. Restores use the updated resource version from the restore response rather than inferring it from a possibly partial page.
