import UserMetaCard from "../components/UserProfile/UserMetaCard";
import UserInfoCard from "../components/UserProfile/UserInfoCard";
import UserProjectsCard from "../components/UserProfile/UserProjectsCard";
import PageMeta from "../components/common/PageMeta";

export default function UserProfiles() {
  return (
    <>
      <PageMeta title="Profile | SmartDoc" description="Your account" />
      {/* Three cards stacked down the page left most of a wide screen empty
          and pushed the last one under the fold. Side by side they fit
          without scrolling. */}
      <div className="space-y-4">
        <UserMetaCard />
        <div className="grid gap-4 lg:grid-cols-2">
          <UserInfoCard />
          <UserProjectsCard />
        </div>
      </div>
    </>
  );
}
