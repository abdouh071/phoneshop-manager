import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/Button';
import styles from './NotFound.module.css';

export const NotFoundPage: React.FC = () => (
  <div className={styles.page}>
    <h1 className={styles.code}>404</h1>
    <p className={styles.title}>This page does not exist.</p>
    <p className={styles.hint}>The address may be old, or mistyped. The rest of the shop is still here.</p>
    <Link to="/">
      <Button variant="primary">Back to Dashboard</Button>
    </Link>
  </div>
);
