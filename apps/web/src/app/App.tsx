import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
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
import {
  initializeRoute,
  navigate,
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

function Home({
  session,
  onSignOut,
}: {
  session: Session;
  onSignOut: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const firstName =
    session.user.displayName.split(" ")[0] || session.user.displayName;
  async function signOut() {
    if (pending) return;
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
    <main className="home-shell">
      <header className="home-header">
        <a className="wordmark dark" href="/home">
          Chalk<span>Talk</span>
        </a>
        <div>
          <span className="avatar" aria-hidden="true">
            {firstName[0]}
          </span>
          <button className="text-button" onClick={signOut} disabled={pending}>
            {pending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </header>
      <section className="home-intro">
        <p className="eyebrow">Tuesday, September 26</p>
        <h1>Welcome back, {firstName}</h1>
        <p>Here’s a small look at what’s moving across your courses.</p>
      </section>
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
      <section className="home-grid">
        <article className="courses-card">
          <div className="section-title">
            <h2>Your courses</h2>
            <span>2 active</span>
          </div>
          <div className="course-row">
            <span className="course-icon amber">LA</span>
            <div>
              <h3>Linear Algebra II</h3>
              <p>MATH 241 · 12 new posts</p>
            </div>
            <span>→</span>
          </div>
          <div className="course-row">
            <span className="course-icon blue">DS</span>
            <div>
              <h3>Data Structures</h3>
              <p>CS 220 · 4 new posts</p>
            </div>
            <span>→</span>
          </div>
        </article>
        <article className="posts-card">
          <div className="section-title">
            <h2>In the discussion</h2>
            <span>View all</span>
          </div>
          <div className="post">
            <p className="post-meta">Linear Algebra II · 8 min ago</p>
            <h3>
              Why does the eigenbasis make this proof feel so much simpler?
            </h3>
            <p>
              “Once the transformation is diagonal, the repeated application is
              easier to see…”
            </p>
            <div>
              <span>◌ 8 replies</span>
              <span>♡ 14</span>
            </div>
          </div>
          <div className="post">
            <p className="post-meta">Data Structures · Yesterday</p>
            <h3>Comparing the two balancing approaches</h3>
          </div>
        </article>
      </section>
    </main>
  );
}

export function App() {
  const [route, setRoute] = useState<Route>(() =>
    routeFromLocation(new URL(window.location.href)),
  );
  const [session, setSession] = useState<Session>();
  const [ready, setReady] = useState(false);
  const sessionRestoreStarted = useRef(false);
  function move(path: string) {
    navigate(path);
    setRoute(initializeRoute(new URL(window.location.href), window.history));
  }
  function startSession(nextSession: Session) {
    setSession(nextSession);
    move("/home");
  }
  useEffect(() => {
    const updateRoute = () =>
      setRoute(initializeRoute(new URL(window.location.href), window.history));
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
        if (route.name === "home") move("/");
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
    return <Home session={session} onSignOut={signOut} />;
  if (route.name === "verify-email")
    return <CreateAccount token={route.token} onSession={startSession} />;
  if (route.name === "reset-password")
    return <ResetPassword token={route.token} onLanding={() => move("/")} />;
  return <Landing onSession={startSession} />;
}
