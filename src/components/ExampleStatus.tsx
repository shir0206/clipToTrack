import SvgIcon from './common/SvgIcon';
import type { ExampleStatus as Status } from '../hooks/useExampleProject';

type Props = {
  status: Status;
  onRetry: () => void;
  onDismiss: () => void;
};

/** Toast while the example is added (instant in practice); shows what went wrong / which files are missing. */
export default function ExampleStatus({ status, onRetry, onDismiss }: Props) {
  if (status.phase === 'idle') return null;

  const failed = status.phase === 'error';
  const partial = failed && !!status.partial;
  const title = !failed
    ? 'Adding the example clips'
    : partial
      ? 'Example project added with missing files'
      : 'Couldn’t load the example project';
  const text = failed ? status.message : 'Reading the route and telemetry…';

  return (
    <div className="ctt-toast" role="status">
      <span className="ctt-toast-ico">
        <SvgIcon name={failed ? 'warning' : 'download'} size={16} />
      </span>
      <div className="ctt-toast-body">
        <strong>{title}</strong>
        <p>{text}</p>
        {failed && !partial && (
          <button className="ctt-link" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
      {failed && (
        <button className="ctt-btn" aria-label="Dismiss" onClick={onDismiss}>
          <SvgIcon name="close" size={13} />
        </button>
      )}
    </div>
  );
}
