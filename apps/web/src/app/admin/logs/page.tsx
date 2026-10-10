import { redirect } from 'next/navigation';
// Old bookmarks return to the dashboard; logs now open from the persistent shell.
export default function LogsPage() { redirect('/servers'); }
