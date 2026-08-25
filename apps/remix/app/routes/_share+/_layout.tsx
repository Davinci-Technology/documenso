import { Outlet } from 'react-router';

import { SourceCodeFooter } from '~/components/general/source-code-footer';

export default function Layout() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-12 md:p-12 lg:p-24">
      <div className="relative w-full">
        <Outlet />
      </div>

      <SourceCodeFooter className="relative mt-6 py-0" />
    </main>
  );
}
