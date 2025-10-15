import { useQuery } from "@tanstack/react-query";
import { fetchMailboxes } from "../api/exchange";

const useMailboxes = () => {
  return useQuery({
    queryKey: ["mailboxes"],
    queryFn: fetchMailboxes,
    staleTime: 5 * 60 * 1000
  });
};

export default useMailboxes;
