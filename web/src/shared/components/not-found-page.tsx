import { Button } from '@heroui/react';
import { useNavigate } from 'react-router-dom';
import { useMessages } from '../../i18n';

export function NotFoundPage() {
  const t = useMessages();
  const navigate = useNavigate();
  return <section className="testflow-panel testflow-empty-state"><h1>{t.common.pageMissing}</h1><p>{t.common.missingDescription}</p><Button onPress={() => navigate('/')}>{t.common.back}</Button></section>;
}
