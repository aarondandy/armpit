using Dapper;

using Microsoft.Data.SqlClient;

namespace Numbers;

class Program
{
    public static string ConnectionStringKey { get; } = "MyDatabase";

    static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        builder.Services.AddRazorPages(o => o.RootDirectory = "/");
        var app = builder.Build();
        app.UseStaticFiles();
        app.MapRazorPages();
        app.Run();
    }
}
