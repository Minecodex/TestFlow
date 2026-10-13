import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { Workflow } from "lucide-react";
import { ApiError, getJson, write } from "../../shared/api/client";
import { Action, Failure, Panel, Text } from "../../shared/ui";
import { useWrite } from "../../shared/api/hooks";
import { useMessages } from "../../i18n";
import { safeReturn } from "../../shared/ui/navigation";
export function SessionGate({ children }: { children: ReactNode }) {
  const t = useMessages();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => getJson("/auth/session"),
    retry: false,
  });
  const location = useLocation();
  const query = useQueryClient();
  useEffect(() => {
    const expire = () => {
      query.setQueryData(["session"], null);
      void query.invalidateQueries({ queryKey: ["session"] });
    };
    window.addEventListener("testflow:session-expired", expire);
    return () => window.removeEventListener("testflow:session-expired", expire);
  }, [query]);
  if (session.isPending)
    return (
      <div className="testflow-login">
        <Workflow />
      </div>
    );
  if (
    session.isError &&
    !(session.error instanceof ApiError && session.error.status === 401)
  )
    return (
      <div className="testflow-login">
        <Panel>
          <Failure error={session.error} />
          <Action
            onPress={() => {
              void session.refetch();
            }}
          >
            {t.common.retry}
          </Action>
        </Panel>
      </div>
    );
  if (!session.data || session.isError)
    return (
      <Navigate
        replace
        to={`/login?return=${encodeURIComponent(location.pathname + location.search)}`}
      />
    );
  return children;
}
export function LoginPage() {
  const t = useMessages();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const mutation = useWrite(() => write<{ username: string }>("/auth/login", { username, password }));
  return (
    <div className="testflow-login">
      <Panel>
        <div className="testflow-login-brand">
          <Workflow />
          <strong>TestFlow</strong>
        </div>
        <h1>{t.auth.title}</h1>
        <p className="testflow-muted">{t.auth.description}</p>
        <form
          className="testflow-stack testflow-mt"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(undefined, {
              onSuccess: (session) => {
                queryClient.setQueryData(["session"], session);
                navigate(safeReturn(params.get("return"), "/"), { replace: true });
              },
            });
          }}
        >
          <Text
            label={t.auth.username}
            name="username"
            value={username}
            onChange={setUsername}
            required
          />
          <Text
            label={t.auth.password}
            name="password"
            value={password}
            onChange={setPassword}
            type="password"
            required
          />
          <Failure error={mutation.error} />
          <Action primary type="submit" isPending={mutation.isPending}>
            {t.auth.login}
          </Action>
        </form>
      </Panel>
    </div>
  );
}
