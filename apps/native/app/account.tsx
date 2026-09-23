import { QueryClientProvider } from "@tanstack/react-query";
import LegacyHome from "@/components/legacy-home";
import { queryClient } from "@/utils/orpc";
export default function AccountScreen() { return <QueryClientProvider client={queryClient}><LegacyHome /></QueryClientProvider>; }
