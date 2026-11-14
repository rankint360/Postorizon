export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { CaptureComponent } from '@gitroom/frontend/components/capture/capture.component';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postorizon' : 'Postorizon'} Capture`,
  description: '',
};
export default async function Index() {
  return <CaptureComponent />;
}
