// Package version carries the sidecar's identity for API-server user agents.
package version

import "fmt"

var buildVersion = "1.1.0-rc.1"

func UserAgent() string {
	return fmt.Sprintf("aster/%s", buildVersion)
}
