export const dynamic = 'force-dynamic';
import { PlatformAdminOverviewComponent } from '@gitroom/frontend/components/admin/platform-admin-overview.component';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';

export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postorizon' : 'Postorizon'} Admin — Overview`,
  description: '',
};

export default async function Page() {
  return (
    <div className="bg-newBgColorInner flex-1 min-w-0 flex-col flex p-[20px] gap-[12px]">
      <PlatformAdminOverviewComponent />
    </div>
  );
}
