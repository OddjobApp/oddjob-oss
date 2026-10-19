import React from "react";
import { PublicForm } from "../PublicForm";

/** /external/forms/:token: a published form on a page of its own. */
export default function PublicFormPage({ params }: { params: { token: string } }) {
  return (
    <main className="min-h-screen bg-muted/30 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <PublicForm token={params.token} />
      </div>
    </main>
  );
}
