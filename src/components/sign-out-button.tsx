"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";

import { clearCurrentUserClientState } from "@/offline/clear-private-client-state";
import { useOfflineCommands } from "@/offline/offline-command-context";

export function SignOutButton() {
  const { commands } = useOfflineCommands();
  const [signingOut, setSigningOut] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <span className="sign-out-control">
      <button
        className="sign-out-button"
        type="button"
        disabled={signingOut}
        aria-describedby={confirming ? "sign-out-pending-warning" : undefined}
        onClick={async () => {
          if (commands.length > 0 && !confirming) {
            setConfirming(true);
            return;
          }
          setSigningOut(true);
          try {
            await clearCurrentUserClientState();
          } finally {
            await signOut({ callbackUrl: "/login" });
          }
        }}
      >
        {signingOut
          ? "退出中…"
          : confirming
            ? `确认退出（丢弃 ${commands.length} 条）`
            : "退出"}
      </button>
      {confirming ? (
        <span id="sign-out-pending-warning" className="sr-only" role="alert">
          退出将清除尚未同步的本机记录；再次点击确认退出。
        </span>
      ) : null}
    </span>
  );
}
