import { Link } from "react-router-dom";

import { EmptyState } from "../components/ui";

export function NotFoundPage(): React.JSX.Element {
  return (
    <div className="page">
      <EmptyState
        title="Page not found"
        body="That page is not part of the Haika lead workspace."
        action={
          <Link className="button button-secondary" to="/">
            Back to overview
          </Link>
        }
      />
    </div>
  );
}
