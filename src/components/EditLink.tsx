import { useEffect, useState } from "react";
import { getToken } from "../lib/store";

/**
 * Edit affordance that only appears once a token is present.
 *
 * Must be client-rendered: the token lives in localStorage, so the server has
 * no idea whether this visitor can write. Keeps the public view clean and
 * read-only rather than dangling a button that would only fail.
 */
export default function EditLink({ href, label = "Edit" }: { href: string; label?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => setShow(Boolean(getToken())), []);
  if (!show) return null;
  return (
    <a className="btn btn-sm" href={href}>
      {label}
    </a>
  );
}
