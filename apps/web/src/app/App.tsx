import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  ApiError,
  createAccount,
  currentSession,
  login,
  logout,
  requestPasswordReset,
  requestVerification,
  resetPassword,
  type Session,
} from "../auth/client.js";
import { CourseDetail, CourseHome } from "../courses/views.js";
import {
  getCourse,
  listCourses,
  type Course,
  type Versioned,
} from "../courses/client.js";
import { Discussion } from "../posts/views.js";
import {
  initializeRoute,
  navigate,
  replaceCurrentFilters,
  replaceCurrentQuery,
  routeFromLocation,
  type Route,
} from "./routes.js";

type LandingPanel = "login" | "signup" | "reset-request";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === "rate_limited")
    return "Too many attempts. Please wait a moment and try again.";
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

function AuthMessage({ error, notice }: { error?: string; notice?: string }) {
  if (error)
    return (
      <p className="form-message error" role="alert">
        {error}
      </p>
    );
  if (notice)
    return (
      <p className="form-message success" role="status">
        {notice}
      </p>
    );
  return null;
}

function LoginForm({
  onSession,
  setPanel,
}: {
  onSession: (session: Session) => void;
  setPanel: (panel: LandingPanel) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      onSession(await login(email, password));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="form-heading">
        <span>Welcome back</span>
        <h2>Sign in to ChalkTalk</h2>
        <p>Pick up the conversation where your class left off.</p>
      </div>
      <AuthMessage error={error} />
      <label>
        Email address
        <input
          autoFocus
          autoComplete="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      <label>
        Password
        <input
          autoComplete="current-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      <button className="button primary" disabled={pending} type="submit">
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <div className="form-links">
        <a
          href="/"
          onClick={(event) => {
            event.preventDefault();
            setPanel("reset-request");
          }}
        >
          Forgot password?
        </a>
        <span>
          New here?{" "}
          <a
            href="/"
            onClick={(event) => {
              event.preventDefault();
              setPanel("signup");
            }}
          >
            Create an account
          </a>
        </span>
      </div>
    </form>
  );
}

function SignupRequestForm({
  setPanel,
}: {
  setPanel: (panel: LandingPanel) => void;
}) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      await requestVerification(email);
      setNotice("Check your inbox for a link to finish creating your account.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="form-heading">
        <span>Join your campus</span>
        <h2>Verify your school email</h2>
        <p>We’ll send a secure link to start your account.</p>
      </div>
      <AuthMessage error={error} notice={notice} />
      <label>
        Email address
        <input
          autoFocus
          autoComplete="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      <button className="button primary" disabled={pending} type="submit">
        {pending ? "Sending…" : "Send verification link"}
      </button>
      <p className="form-links">
        <a
          href="/"
          onClick={(event) => {
            event.preventDefault();
            setPanel("login");
          }}
        >
          Back to sign in
        </a>
      </p>
    </form>
  );
}

function ResetRequestForm({
  setPanel,
}: {
  setPanel: (panel: LandingPanel) => void;
}) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      await requestPasswordReset(email);
      setNotice(
        "If an account matches that email, we’ll send a password reset link.",
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="form-heading">
        <span>Account recovery</span>
        <h2>Reset your password</h2>
        <p>Enter your school email and we’ll help you get back in.</p>
      </div>
      <AuthMessage error={error} notice={notice} />
      <label>
        Email address
        <input
          autoFocus
          autoComplete="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      <button className="button primary" disabled={pending} type="submit">
        {pending ? "Sending…" : "Send reset link"}
      </button>
      <p className="form-links">
        <a
          href="/"
          onClick={(event) => {
            event.preventDefault();
            setPanel("login");
          }}
        >
          Back to sign in
        </a>
      </p>
    </form>
  );
}

function Landing({ onSession }: { onSession: (session: Session) => void }) {
  const [panel, setPanel] = useState<LandingPanel>("login");
  return (
    <main className="landing-shell">
      <section className="brand-panel" aria-label="About ChalkTalk">
        <a className="wordmark" href="/">
          Chalk<span>Talk</span>
        </a>
        <div className="hero-copy">
          <p className="eyebrow">Built for the learning in between</p>
          <h1>Discuss the work that matters.</h1>
          <p>
            One focused place for questions, ideas, and the conversations that
            make a course stick.
          </p>
        </div>
        <div className="hero-details">
          <div>
            <strong>Made for classes</strong>
            <span>Keep discussion close to the course.</span>
          </div>
          <div>
            <strong>Designed for momentum</strong>
            <span>Turn a good question into shared understanding.</span>
          </div>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          {panel === "login" ? (
            <LoginForm onSession={onSession} setPanel={setPanel} />
          ) : panel === "signup" ? (
            <SignupRequestForm setPanel={setPanel} />
          ) : (
            <ResetRequestForm setPanel={setPanel} />
          )}
        </div>
        <p className="privacy-note">
          Your account is tied to your school email. We never share it with
          classmates.
        </p>
      </section>
    </main>
  );
}

function AuthRoute({ children }: { children: ReactNode }) {
  return (
    <main className="route-shell">
      <a className="wordmark dark" href="/">
        Chalk<span>Talk</span>
      </a>
      <section className="route-card">{children}</section>
    </main>
  );
}
function LinkProblem({ title }: { title: string }) {
  return (
    <AuthRoute>
      <div className="auth-form">
        <div className="form-heading">
          <span>Link unavailable</span>
          <h1>{title}</h1>
          <p>Request a new email link and we’ll get you back on track.</p>
        </div>
        <button className="button primary" onClick={() => navigate("/")}>
          Return to sign in
        </button>
      </div>
    </AuthRoute>
  );
}

function CreateAccount({
  token,
  onSession,
}: {
  token?: string;
  onSession: (session: Session) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  if (!token)
    return <LinkProblem title="This verification link is incomplete." />;
  const verificationToken = token;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      const user = await createAccount({
        verificationToken,
        displayName,
        password,
      });
      onSession(await login(user.email, password));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }
  return (
    <AuthRoute>
      <form className="auth-form" onSubmit={submit}>
        <div className="form-heading">
          <span>One last step</span>
          <h1>Create your ChalkTalk account</h1>
          <p>Choose the name your classmates will see.</p>
        </div>
        <AuthMessage error={error} />
        <label>
          Display name
          <input
            autoFocus
            autoComplete="name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
        </label>
        <label>
          New password
          <input
            autoComplete="new-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={12}
            required
          />
        </label>
        <button className="button primary" type="submit" disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthRoute>
  );
}

function ResetPassword({
  token,
  onLanding,
}: {
  token?: string;
  onLanding: () => void;
}) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [complete, setComplete] = useState(false);
  if (!token)
    return <LinkProblem title="This password reset link is incomplete." />;
  const resetToken = token;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      await resetPassword(resetToken, password);
      setComplete(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }
  return (
    <AuthRoute>
      <form className="auth-form" onSubmit={submit}>
        <div className="form-heading">
          <span>Choose a new password</span>
          <h1>Set a new password</h1>
          <p>Use at least 12 characters to keep your account secure.</p>
        </div>
        <AuthMessage
          error={error}
          notice={complete ? "Password reset. You can now sign in." : undefined}
        />
        <label>
          New password
          <input
            autoFocus
            autoComplete="new-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={12}
            required
            disabled={complete}
          />
        </label>
        {complete ? (
          <button className="button primary" type="button" onClick={onLanding}>
            Go to sign in
          </button>
        ) : (
          <button className="button primary" type="submit" disabled={pending}>
            {pending ? "Resetting…" : "Reset password"}
          </button>
        )}
      </form>
    </AuthRoute>
  );
}

function isPlainClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function CourseSwitcher({
  currentCourseId,
  onChoose,
}: {
  currentCourseId?: string;
  onChoose: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [courses, setCourses] = useState<Course[]>();
  const [error, setError] = useState<string>();
  const [cycle, setCycle] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  // Courses load on first open so that rendering the shell adds no requests.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError(undefined);
    void listCourses()
      .then((page) => {
        if (active) setCourses(page.data);
      })
      .catch((caught) => {
        if (active) setError(errorMessage(caught));
      });
    return () => {
      active = false;
    };
  }, [open, cycle]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  function choose(event: MouseEvent<HTMLAnchorElement>, path: string) {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    setOpen(false);
    onChoose(path);
  }
  return (
    <div className="course-switcher" ref={root}>
      <button
        ref={toggle}
        type="button"
        className="switcher-button"
        aria-expanded={open}
        aria-controls="course-switcher-panel"
        onClick={() => setOpen((value) => !value)}
      >
        Switch course
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div id="course-switcher-panel" className="switcher-panel">
          {error ? (
            <div className="switcher-message">
              <p role="alert">{error}</p>
              <button
                type="button"
                className="text-button"
                onClick={() => setCycle((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          ) : !courses ? (
            <p className="switcher-message" role="status">
              Loading courses…
            </p>
          ) : courses.length ? (
            <ul aria-label="Your courses">
              {courses.map((course) => {
                const path = `/courses/${encodeURIComponent(course.id)}`;
                return (
                  <li key={course.id}>
                    <a
                      href={path}
                      aria-current={
                        course.id === currentCourseId ? "page" : undefined
                      }
                      onClick={(event) => choose(event, path)}
                    >
                      <span className="course-icon amber" aria-hidden="true">
                        {course.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span>{course.name}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="switcher-message">
              You have not joined a course yet.
            </p>
          )}
          <a
            className="switcher-home"
            href="/home"
            onClick={(event) => choose(event, "/home")}
          >
            All courses
          </a>
        </div>
      )}
    </div>
  );
}

function AppShell({
  session,
  onSignOut,
  onNavigate,
  canLeave = () => true,
  currentCourseId,
  courseTitle,
  courseNav,
  children,
}: {
  session: Session;
  onSignOut: () => Promise<void>;
  onNavigate: (path: string) => void;
  canLeave?: () => boolean;
  currentCourseId?: string;
  courseTitle?: ReactNode;
  courseNav?: ReactNode;
  children: ReactNode;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const displayName = session.user.displayName;
  function go(path: string) {
    if (canLeave()) onNavigate(path);
  }
  async function signOut() {
    if (pending || !canLeave()) return;
    setPending(true);
    setError(undefined);
    try {
      await onSignOut();
    } catch (caught) {
      setError(errorMessage(caught));
      setPending(false);
    }
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-start">
          <a
            className="wordmark dark"
            href="/home"
            onClick={(event) => {
              if (!isPlainClick(event)) return;
              event.preventDefault();
              go("/home");
            }}
          >
            Chalk<span>Talk</span>
          </a>
          <CourseSwitcher currentCourseId={currentCourseId} onChoose={go} />
        </div>
        {courseTitle && (
          <div className="topbar-course">
            {courseTitle}
            {courseNav}
          </div>
        )}
        <div className="topbar-end">
          <span className="avatar" aria-hidden="true" title={displayName}>
            {(displayName.trim()[0] ?? "?").toUpperCase()}
          </span>
          <span className="visually-hidden">Signed in as {displayName}</span>
          <button className="text-button" onClick={signOut} disabled={pending}>
            {pending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </header>
      {error && (
        <p className="form-message error shell-alert" role="alert">
          {error}
        </p>
      )}
      {children}
    </div>
  );
}

function Home({
  session,
  onOpenCourse,
}: {
  session: Session;
  onOpenCourse: (courseId: string) => void;
}) {
  const firstName =
    session.user.displayName.split(" ")[0] || session.user.displayName;
  const today = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
  return (
    <main className="home-shell">
      <section className="home-intro">
        <p className="eyebrow">{today}</p>
        <h1>Welcome back, {firstName}</h1>
        <p>Pick up where your courses left off.</p>
      </section>
      <CourseHome csrfToken={session.csrfToken} onOpenCourse={onOpenCourse} />
    </main>
  );
}

function CourseFrame({
  route,
  session,
  onNavigate,
  onSignOut,
  onBeforeLeaveChange,
}: {
  route: Route;
  session: Session;
  onNavigate: (path: string) => void;
  onSignOut: () => Promise<void>;
  onBeforeLeaveChange: (guard: () => boolean) => void;
}) {
  const courseId = route.courseId!;
  const [course, setCourse] = useState<Versioned<Course>>();
  const [error, setError] = useState<{ courseId: string; message: string }>();
  const [cycle, setCycle] = useState(0);
  const beforeLeave = useRef<() => boolean>(() => true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const visibleCourse = course?.data.id === courseId ? course : undefined;
  useEffect(() => {
    let active = true;
    setCourse(undefined);
    setError(undefined);
    void getCourse(courseId)
      .then((next) => {
        if (active) setCourse(next);
      })
      .catch((caught) => {
        if (active) setError({ courseId, message: errorMessage(caught) });
      });
    return () => {
      active = false;
    };
  }, [courseId, cycle]);
  useEffect(() => {
    if (visibleCourse) headingRef.current?.focus();
  }, [route.name, visibleCourse]);
  const settings = route.name === "course-settings";
  const discussionPath = `/courses/${encodeURIComponent(courseId)}`;
  function follow(event: MouseEvent<HTMLAnchorElement>, path: string) {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    if (beforeLeave.current()) onNavigate(path);
  }
  return (
    <AppShell
      session={session}
      onSignOut={onSignOut}
      onNavigate={onNavigate}
      canLeave={() => beforeLeave.current()}
      currentCourseId={courseId}
      courseTitle={
        <h1 ref={headingRef} tabIndex={-1} className="topbar-course-name">
          {visibleCourse?.data.name ??
            (error?.courseId === courseId
              ? "Course unavailable"
              : "Loading course…")}
        </h1>
      }
      courseNav={
        <nav aria-label="Course navigation" className="course-tabs">
          <a
            href={discussionPath}
            aria-current={!settings ? "page" : undefined}
            onClick={(event) => follow(event, discussionPath)}
          >
            Discussion
          </a>
          <a
            href={`${discussionPath}/settings`}
            aria-current={settings ? "page" : undefined}
            onClick={(event) => follow(event, `${discussionPath}/settings`)}
          >
            Course settings
          </a>
        </nav>
      }
    >
      <main className={settings ? "course-main settings-main" : "course-main"}>
        {error?.courseId === courseId ? (
          <div className="course-message" role="alert">
            {error.message}{" "}
            <button
              className="text-button"
              onClick={() => setCycle((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        ) : !visibleCourse ? (
          <p className="course-message" role="status">
            Loading course…
          </p>
        ) : settings ? (
          <CourseDetail
            key={courseId}
            courseId={courseId}
            course={visibleCourse}
            onCourseChange={setCourse}
            csrfToken={session.csrfToken}
            onBack={() => onNavigate("/home")}
            userId={session.user.id}
          />
        ) : (
          <Discussion
            courseId={courseId}
            course={visibleCourse.data}
            userId={session.user.id}
            postId={route.postId}
            query={route.query}
            filters={route.filters}
            csrfToken={session.csrfToken}
            onNavigate={onNavigate}
            onQueryChange={replaceCurrentQuery}
            onFiltersChange={replaceCurrentFilters}
            onBeforeLeaveChange={(guard) => {
              beforeLeave.current = guard;
              onBeforeLeaveChange(guard);
            }}
          />
        )}
      </main>
    </AppShell>
  );
}

export function App() {
  const [route, setRoute] = useState<Route>(() =>
    routeFromLocation(new URL(window.location.href)),
  );
  const [session, setSession] = useState<Session>();
  const [ready, setReady] = useState(false);
  const sessionRestoreStarted = useRef(false);
  const beforeCourseLeave = useRef<() => boolean>(() => true);
  const lastPath = useRef(
    `${window.location.pathname}${window.location.search}`,
  );
  const internalNavigation = useRef(false);
  function move(path: string) {
    internalNavigation.current = true;
    navigate(path);
    lastPath.current = path;
    setRoute(initializeRoute(new URL(window.location.href), window.history));
  }
  function startSession(nextSession: Session) {
    setSession(nextSession);
    move("/home");
  }
  useEffect(() => {
    const updateRoute = () => {
      const nextPath = `${window.location.pathname}${window.location.search}`;
      if (
        !internalNavigation.current &&
        window.location.pathname !==
          new URL(lastPath.current, window.location.origin).pathname &&
        !beforeCourseLeave.current()
      ) {
        window.history.pushState(null, "", lastPath.current);
        return;
      }
      internalNavigation.current = false;
      lastPath.current = nextPath;
      setRoute(initializeRoute(new URL(window.location.href), window.history));
    };
    window.addEventListener("popstate", updateRoute);
    return () => window.removeEventListener("popstate", updateRoute);
  }, []);

  useEffect(() => {
    if (route.token)
      window.history.replaceState(null, "", window.location.pathname);
    // The emailed token remains in React state but never in the visible URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (sessionRestoreStarted.current) return;
    sessionRestoreStarted.current = true;
    void currentSession()
      .then((restored) => {
        setSession(restored);
        if (route.name === "landing") move("/home");
      })
      .catch(() => {
        if (
          route.name === "home" ||
          route.name === "course" ||
          route.name === "post" ||
          route.name === "course-settings"
        )
          move("/");
      })
      .finally(() => setReady(true));
    // This intentionally restores browser session once, rather than on navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function signOut() {
    if (session) await logout(session.csrfToken);
    setSession(undefined);
    move("/");
  }
  if (!ready)
    return (
      <main className="loading" aria-live="polite">
        Loading ChalkTalk…
      </main>
    );
  if (route.name === "home" && session)
    return (
      <AppShell session={session} onSignOut={signOut} onNavigate={move}>
        <Home
          session={session}
          onOpenCourse={(courseId) => move(`/courses/${courseId}`)}
        />
      </AppShell>
    );
  if (
    (route.name === "course" ||
      route.name === "post" ||
      route.name === "course-settings") &&
    route.courseId &&
    session
  )
    return (
      <CourseFrame
        route={route}
        session={session}
        onNavigate={move}
        onSignOut={signOut}
        onBeforeLeaveChange={(guard) => {
          beforeCourseLeave.current = guard;
        }}
      />
    );
  if (route.name === "verify-email")
    return <CreateAccount token={route.token} onSession={startSession} />;
  if (route.name === "reset-password")
    return <ResetPassword token={route.token} onLanding={() => move("/")} />;
  return <Landing onSession={startSession} />;
}
