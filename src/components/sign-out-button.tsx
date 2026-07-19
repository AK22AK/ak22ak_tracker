"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";

import { clearCurrentUserClientState } from "@/offline/clear-private-client-state";

export function SignOutButton() {
  const [signingOut, setSigningOut] = useState(false);

  return (
    <button
      className="sign-out-button"
      type="button"
      disabled={signingOut}
      onClick={async () => {
        setSigningOut(true);
        try {
          await clearCurrentUserClientState();
        } finally {
          await signOut({ callbackUrl: "/login" });
        }
      }}
    >
      {signingOut ? "退出中…" : "退出"}
    </button>
  );
}
