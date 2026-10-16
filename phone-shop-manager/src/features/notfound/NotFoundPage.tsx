import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import styles from './NotFound.module.css';

export const NotFoundPage = () => {
  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <div className={styles.errorCode}>404</div>
        <h1 className={styles.title}>Page Not Found</h1>
        <p className={styles.message}>
          The page you are looking for doesn't exist or has been moved.
        </p>
        <Link to="/">
          <Button size="lg" leftIcon={<Home size={18} />}>
            Back to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
};
