using System;
using System.IO;
using System.Web.Script.Serialization;
internal static class UpdateHarness
{
    private static int Main(string[] args) {
        System.Net.ServicePointManager.SecurityProtocol = System.Net.SecurityProtocolType.Tls12;
        try {
            if (args[0] == "verify") Console.WriteLine(PortableUpdates.Text(PortableUpdates.Verify(File.ReadAllText(args[1])), "version"));
            else if (args[0] == "compare") Console.WriteLine(PortableUpdates.Compare(args[1], args[2]));
            else if (args[0] == "extract") PortableUpdates.ExtractArchive(args[1], args[2], true);
            else if (args[0] == "select" || args[0] == "select-online") { var s = PortableUpdates.Select(args[1], args[2], args[0] == "select-online"); Console.WriteLine(new JavaScriptSerializer().Serialize(new { runtime = s.Runtime, version = s.Version, pending = s.Pending, full = s.NewRuntimeEnvelope != null })); }
            else if (args[0] == "commit") PortableUpdates.Commit(args[1], new UpdateSelection { Pending = true, Envelope = File.ReadAllText(args[2]), NewRuntimeEnvelope = args.Length > 3 ? File.ReadAllText(args[3]) : null });
            else if (args[0] == "launch") {
                string envelope = File.ReadAllText(args[3]); var release = PortableUpdates.Verify(envelope);
                string runtime = PortableUpdates.Prepare(Path.Combine(args[1], "updates"), args[2], release, UpdateConfig.RuntimeId);
                PortableLauncher.LaunchDesktop(new UpdateSelection { Runtime = runtime, PreviousRuntime = args[2], Pending = true, Envelope = envelope,
                    Version = PortableUpdates.Text(release, "version") }, args[1], args[4], new[] { "--background" });
            }
            else throw new Exception("Unknown test action.");
            return 0;
        } catch(Exception e) { Console.Error.WriteLine(e.Message); return 1; }
    }
}
