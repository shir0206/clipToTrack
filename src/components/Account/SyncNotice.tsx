import { useState } from 'react';
import Icon from '../Icon/Icon';
import { useSyncStatus } from '../../lib/sync/prefSync';

/** Toast while the developer's kill switch has cloud sync paused. Nothing else about sync is shown here. */
export default function SyncNotice() {
  const status = useSyncStatus();
  const [dismissed, setDismissed] = useState(false);
  if (status !== 'paused' || dismissed) return null;
  return (
    <div className="ctt-toast" role="status">
      <span className="ctt-toast-ico">
        <Icon name="info" size={16} />
      </span>
      <div className="ctt-toast-body">
        <strong>Cloud sync is paused</strong>
        <p>Your changes are kept on this device and will sync when it is back.</p>
      </div>
      <button className="ctt-btn" aria-label="Dismiss" onClick={() => setDismissed(true)}>
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}
