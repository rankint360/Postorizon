export const dynamic = 'force-dynamic';
import { PlatformAdminOrganizationsComponent } from '@gitroom/frontend/components/admin/platform-admin-organizations.component';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';

export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postorizon' : 'Postorizon'} Admin — Organizations`,
  description: '',
};

export default async function Page() {
  return (
    <div className="bg-newBgColorInner flex-1 min-w-0 flex-col flex p-[20px] gap-[12px]">
      <PlatformAdminOrganizationsComponent />
    </div>
  );
}
